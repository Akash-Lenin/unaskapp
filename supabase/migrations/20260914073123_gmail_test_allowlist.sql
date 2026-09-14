create table private.test_access_allowlist (
  email text primary key check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role text not null check (role in ('employee', 'hr', 'responder')),
  responder_label text,
  created_at timestamptz not null default now(),
  check (
    (role = 'responder' and nullif(btrim(responder_label), '') is not null)
    or (role <> 'responder' and responder_label is null)
  )
);

alter table private.test_access_allowlist enable row level security;

create policy test_access_allowlist_no_browser_access
on private.test_access_allowlist
for all
to anon, authenticated
using (false)
with check (false);

revoke all on private.test_access_allowlist from public, anon, authenticated;
grant all on private.test_access_allowlist to service_role;

insert into private.test_access_allowlist (email, role, responder_label)
values
  ('akashlenin09@gmail.com', 'responder', 'Akash · Test Responder'),
  ('subhashree8925@gmail.com', 'employee', null),
  ('subhashree0209@gmail.com', 'employee', null);

create or replace function public.is_everstage_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select
    (select auth.uid()) is not null
    and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) is false
    and (
      lower(coalesce((select auth.jwt())->'app_metadata'->>'provider', '')) = 'google'
      or coalesce(
        (select auth.jwt())->'app_metadata'->'providers',
        '[]'::jsonb
      ) ? 'google'
    )
    and (
      lower(coalesce((select auth.jwt())->>'email', '')) ~ '^[^@[:space:]]+@everstage[.]com$'
      or exists (
        select 1
        from private.test_access_allowlist a
        where a.email = lower(coalesce((select auth.jwt())->>'email', ''))
      )
    );
$$;

create or replace function private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select case
    when not public.is_everstage_user() then null
    else coalesce(
      (
        select sr.role::text
        from private.staff_roles sr
        where sr.user_id = (select auth.uid())
      ),
      (
        select a.role
        from private.test_access_allowlist a
        where a.email = lower(coalesce((select auth.jwt())->>'email', ''))
          and a.role in ('hr', 'responder')
      ),
      nullif((select auth.jwt())->'app_metadata'->>'unask_role', '')
    )
  end;
$$;

create or replace function private.current_responder_label()
returns text
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select case
    when not public.is_everstage_user() then null
    else coalesce(
      (
        select sr.responder_label
        from private.staff_roles sr
        where sr.user_id = (select auth.uid())
          and sr.role = 'responder'::private.unask_staff_role
      ),
      (
        select a.responder_label
        from private.test_access_allowlist a
        where a.email = lower(coalesce((select auth.jwt())->>'email', ''))
          and a.role = 'responder'
      ),
      nullif((select auth.jwt())->'app_metadata'->>'responder_label', '')
    )
  end;
$$;

create or replace function public.list_unask_responders()
returns table (responder_label text)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select labels.responder_label
  from (
    select sr.responder_label
    from private.staff_roles sr
    where sr.role = 'responder'::private.unask_staff_role
    union
    select a.responder_label
    from private.test_access_allowlist a
    where a.role = 'responder'
    union
    select nullif(u.raw_app_meta_data->>'responder_label', '')
    from auth.users u
    where u.raw_app_meta_data->>'unask_role' = 'responder'
  ) labels
  where private.current_staff_role() = 'hr'
    and labels.responder_label is not null
  order by labels.responder_label;
$$;

create or replace function public.moderate_unask_question(
  p_question_id bigint,
  p_action text,
  p_private_reply text default null,
  p_responder_label text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $$
declare
  v_reply text := nullif(btrim(coalesce(p_private_reply, '')), '');
  v_responder text := nullif(btrim(coalesce(p_responder_label, '')), '');
  v_changed bigint;
begin
  if not public.is_everstage_user() or private.current_staff_role() <> 'hr' then
    raise exception 'HR access is required';
  end if;

  if p_action = 'clarify' then
    if v_reply is null or char_length(v_reply) > 4000 then
      raise exception 'A private reply between 1 and 4000 characters is required';
    end if;
    update private.question_threads
    set private_reply = v_reply
    where question_id = p_question_id;
    get diagnostics v_changed = row_count;
    if v_changed = 0 then
      raise exception 'This question has no recoverable anonymous thread';
    end if;
    update public.questions
    set status = 'Needs clarification'
    where id = p_question_id
      and status in ('Under review', 'Needs clarification');
  elsif p_action = 'assign' then
    if v_responder is null or char_length(v_responder) > 120 then
      raise exception 'A configured responder is required';
    end if;
    if not exists (
      select 1 from private.staff_roles sr
      where sr.role = 'responder'::private.unask_staff_role
        and sr.responder_label = v_responder
    ) and not exists (
      select 1 from private.test_access_allowlist a
      where a.role = 'responder'
        and a.responder_label = v_responder
    ) and not exists (
      select 1 from auth.users u
      where u.raw_app_meta_data->>'unask_role' = 'responder'
        and u.raw_app_meta_data->>'responder_label' = v_responder
    ) then
      raise exception 'The selected responder is not configured';
    end if;
    update public.questions
    set status = 'Assigned', responder_label = v_responder
    where id = p_question_id
      and status in ('Under review', 'Needs clarification');
  elsif p_action = 'close' then
    update public.questions
    set status = 'Closed', responder_label = null
    where id = p_question_id
      and status in ('Under review', 'Needs clarification');
  else
    raise exception 'Invalid moderation action';
  end if;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'Question not found';
  end if;

  insert into private.question_audit_events (
    question_id, actor_user_id, action, details
  ) values (
    p_question_id,
    (select auth.uid()),
    'question_' || p_action,
    jsonb_strip_nulls(jsonb_build_object(
      'responder_label', v_responder,
      'has_private_reply', case when p_action = 'clarify' then true else null end
    ))
  );
end;
$$;

revoke all on function public.is_everstage_user() from public, anon;
grant execute on function public.is_everstage_user() to authenticated;

comment on table private.test_access_allowlist
  is 'Temporary Google account allowlist for controlled Unask testing; never exposed to browser roles.';
