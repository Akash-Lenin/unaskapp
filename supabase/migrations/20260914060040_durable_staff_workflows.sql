-- Durable, role-secured moderation, assignment, clarification, and response
-- workflows for Unask. Feedback author identity is never stored with content.

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
      nullif((select auth.jwt())->'app_metadata'->>'responder_label', '')
    )
  end;
$$;

revoke all on function private.current_staff_role() from public, anon;
revoke all on function private.current_responder_label() from public, anon;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.current_responder_label() to authenticated;

-- Preserve any trusted legacy staff claims while making staff_roles canonical.
insert into private.staff_roles (user_id, role, responder_label)
select
  u.id,
  (u.raw_app_meta_data->>'unask_role')::private.unask_staff_role,
  case
    when u.raw_app_meta_data->>'unask_role' = 'responder'
      then nullif(u.raw_app_meta_data->>'responder_label', '')
    else null
  end
from auth.users u
where u.raw_app_meta_data->>'unask_role' in ('hr', 'responder')
  and lower(coalesce(u.email, '')) ~ '^[^@[:space:]]+@everstage[.]com$'
  and (
    lower(coalesce(u.raw_app_meta_data->>'provider', '')) = 'google'
    or coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
  )
  and (
    u.raw_app_meta_data->>'unask_role' = 'hr'
    or nullif(u.raw_app_meta_data->>'responder_label', '') is not null
  )
on conflict (user_id) do nothing;

-- Move legacy capability hashes and replies out of the exposed table.
insert into private.question_threads (question_id, token_hash, private_reply)
select q.id, q.thread_key, q.private_reply
from public.questions q
where q.thread_key is not null
on conflict (question_id) do update
set
  token_hash = excluded.token_hash,
  private_reply = coalesce(excluded.private_reply, private.question_threads.private_reply),
  updated_at = now();

update public.questions
set thread_key = null, private_reply = null
where thread_key is not null or private_reply is not null;

create or replace function public.get_staff_profile()
returns table (staff_role text, responder_label text)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select
    private.current_staff_role(),
    private.current_responder_label()
  where public.is_everstage_user();
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
    select nullif(u.raw_app_meta_data->>'responder_label', '')
    from auth.users u
    where u.raw_app_meta_data->>'unask_role' = 'responder'
  ) labels
  where private.current_staff_role() = 'hr'
    and labels.responder_label is not null
  order by labels.responder_label;
$$;

create or replace function public.submit_unask_question(
  p_question text,
  p_detail text,
  p_visibility text,
  p_display_name text,
  p_thread_hash text
)
returns table (
  id bigint,
  question text,
  detail text,
  status public.question_status,
  visibility public.question_visibility,
  display_name text,
  upvotes integer,
  dislikes integer,
  comments_count integer,
  responder_label text,
  answer text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $$
declare
  v_question public.questions%rowtype;
  v_question_text text := btrim(coalesce(p_question, ''));
  v_detail_text text := btrim(coalesce(p_detail, ''));
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if not public.is_everstage_user() then
    raise exception 'Verified Everstage access is required';
  end if;
  if char_length(v_question_text) not between 3 and 500 then
    raise exception 'Question must be between 3 and 500 characters';
  end if;
  if char_length(v_detail_text) > 4000 then
    raise exception 'Context must be at most 4000 characters';
  end if;
  if p_visibility not in ('anonymous', 'named') then
    raise exception 'Invalid visibility';
  end if;
  if p_visibility = 'anonymous' then
    v_display_name := null;
  elsif v_display_name is null or char_length(v_display_name) > 80 then
    raise exception 'Display name must be between 1 and 80 characters';
  end if;
  if p_thread_hash is null or p_thread_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid thread capability';
  end if;

  insert into public.questions (
    question, detail, visibility, display_name, thread_key
  ) values (
    v_question_text,
    v_detail_text,
    p_visibility::public.question_visibility,
    v_display_name,
    null
  )
  returning * into v_question;

  insert into private.question_threads (question_id, token_hash)
  values (v_question.id, p_thread_hash);

  return query
  select
    v_question.id,
    v_question.question,
    v_question.detail,
    v_question.status,
    v_question.visibility,
    v_question.display_name,
    v_question.upvotes,
    v_question.dislikes,
    v_question.comments_count,
    v_question.responder_label,
    v_question.answer,
    v_question.created_at,
    v_question.updated_at;
end;
$$;

create or replace function public.get_unask_question_thread(
  p_question_id bigint,
  p_thread_hash text
)
returns table (
  id bigint,
  question text,
  detail text,
  status public.question_status,
  visibility public.question_visibility,
  display_name text,
  upvotes integer,
  dislikes integer,
  comments_count integer,
  responder_label text,
  answer text,
  private_reply text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select
    q.id,
    q.question,
    q.detail,
    q.status,
    q.visibility,
    q.display_name,
    q.upvotes,
    q.dislikes,
    q.comments_count,
    q.responder_label,
    q.answer,
    t.private_reply,
    q.created_at,
    q.updated_at
  from public.questions q
  join private.question_threads t on t.question_id = q.id
  where public.is_everstage_user()
    and q.id = p_question_id
    and p_thread_hash ~ '^[0-9a-f]{64}$'
    and t.token_hash = p_thread_hash;
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

create or replace function public.publish_unask_answer(
  p_question_id bigint,
  p_answer text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, public
as $$
declare
  v_answer text := btrim(coalesce(p_answer, ''));
  v_changed bigint;
begin
  if not public.is_everstage_user()
    or private.current_staff_role() <> 'responder'
    or private.current_responder_label() is null then
    raise exception 'Responder access is required';
  end if;
  if char_length(v_answer) not between 1 and 8000 then
    raise exception 'Answer must be between 1 and 8000 characters';
  end if;

  update public.questions
  set status = 'Answered', answer = v_answer
  where id = p_question_id
    and status = 'Assigned'
    and responder_label = private.current_responder_label();
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'Assigned question not found';
  end if;

  insert into private.question_audit_events (
    question_id, actor_user_id, action, details
  ) values (
    p_question_id,
    (select auth.uid()),
    'answer_published',
    jsonb_build_object('responder_label', private.current_responder_label())
  );
end;
$$;

create or replace function public.vote_question(
  p_question_id bigint,
  p_direction text
)
returns table (upvotes integer, dislikes integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_everstage_user() then
    raise exception 'Verified Everstage access is required';
  end if;
  if p_direction not in ('up', 'down') then
    raise exception 'Invalid vote direction';
  end if;

  return query
  update public.questions q
  set
    upvotes = q.upvotes + case when p_direction = 'up' then 1 else 0 end,
    dislikes = q.dislikes + case when p_direction = 'down' then 1 else 0 end
  where q.id = p_question_id
    and q.status in ('Assigned', 'Answered')
  returning q.upvotes, q.dislikes;
end;
$$;

drop policy if exists questions_everstage_read on public.questions;
create policy questions_everstage_read
on public.questions
for select
to authenticated
using (
  (select public.is_everstage_user())
  and (
    status in ('Assigned', 'Answered')
    or (select private.current_staff_role()) = 'hr'
    or (
      (select private.current_staff_role()) = 'responder'
      and responder_label = (select private.current_responder_label())
    )
  )
);

drop policy if exists questions_everstage_submit on public.questions;
drop policy if exists questions_everstage_update on public.questions;

drop policy if exists question_thoughts_everstage_read on public.question_thoughts;
create policy question_thoughts_everstage_read
on public.question_thoughts
for select
to authenticated
using (
  (select public.is_everstage_user())
  and (
    status = 'published'
    or (select private.current_staff_role()) = 'hr'
  )
);

drop policy if exists question_thoughts_hr_update on public.question_thoughts;
create policy question_thoughts_hr_update
on public.question_thoughts
for update
to authenticated
using (
  (select public.is_everstage_user())
  and (select private.current_staff_role()) = 'hr'
)
with check (
  (select public.is_everstage_user())
  and (select private.current_staff_role()) = 'hr'
);

revoke insert on public.questions from authenticated;
revoke insert (question, detail, visibility, display_name, thread_key)
  on public.questions from authenticated;
revoke update on public.questions from authenticated;
revoke update (status, responder_label, answer, private_reply, upvotes, dislikes)
  on public.questions from authenticated;

revoke all on function public.get_staff_profile() from public, anon;
revoke all on function public.list_unask_responders() from public, anon;
revoke all on function public.submit_unask_question(text, text, text, text, text) from public, anon;
revoke all on function public.get_unask_question_thread(bigint, text) from public, anon;
revoke all on function public.moderate_unask_question(bigint, text, text, text) from public, anon;
revoke all on function public.publish_unask_answer(bigint, text) from public, anon;
revoke all on function public.vote_question(bigint, text) from public, anon;

grant execute on function public.get_staff_profile() to authenticated;
grant execute on function public.list_unask_responders() to authenticated;
grant execute on function public.submit_unask_question(text, text, text, text, text) to authenticated;
grant execute on function public.get_unask_question_thread(bigint, text) to authenticated;
grant execute on function public.moderate_unask_question(bigint, text, text, text) to authenticated;
grant execute on function public.publish_unask_answer(bigint, text) to authenticated;
grant execute on function public.vote_question(bigint, text) to authenticated;

comment on function public.submit_unask_question(text, text, text, text, text)
  is 'Creates anonymous feedback and stores its capability hash only in the private schema.';
comment on function public.get_unask_question_thread(bigint, text)
  is 'Returns one anonymous thread only when its capability hash matches.';
comment on function public.moderate_unask_question(bigint, text, text, text)
  is 'Performs audited HR clarification, assignment, and closure operations.';
comment on function public.publish_unask_answer(bigint, text)
  is 'Publishes an audited answer only for the assigned responder.';
