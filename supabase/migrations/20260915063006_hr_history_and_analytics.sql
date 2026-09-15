-- HR history, reversible question moderation, HR answering, and aggregate analytics.

alter table public.questions
  add column if not exists moderation_state text not null default 'active'
    check (moderation_state in ('active', 'hidden', 'deleted')),
  add column if not exists moderated_at timestamptz;

create index if not exists questions_moderation_status_created_idx
  on public.questions (moderation_state, status, created_at desc);

drop policy if exists questions_everstage_read on public.questions;
create policy questions_everstage_read
on public.questions
for select
to authenticated
using (
  (select public.is_everstage_user())
  and (
    (select private.current_staff_role()) = 'hr'
    or (
      moderation_state = 'active'
      and (
        status in ('Assigned', 'Answered')
        or (
          (select private.current_staff_role()) = 'responder'
          and responder_label = (select private.current_responder_label())
        )
      )
    )
  )
);

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
    union
    select 'People Team · HR'
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
    set private_reply = v_reply, updated_at = now()
    where question_id = p_question_id;
    get diagnostics v_changed = row_count;
    if v_changed = 0 then
      raise exception 'This question has no recoverable anonymous thread';
    end if;
    update public.questions
    set status = 'Needs clarification', updated_at = now()
    where id = p_question_id
      and moderation_state = 'active'
      and status in ('Under review', 'Needs clarification');
  elsif p_action = 'assign' then
    if v_responder is null or char_length(v_responder) > 120 then
      raise exception 'A configured responder is required';
    end if;
    if v_responder <> 'People Team · HR'
      and not exists (
        select 1 from private.staff_roles sr
        where sr.role = 'responder'::private.unask_staff_role
          and sr.responder_label = v_responder
      )
      and not exists (
        select 1 from private.test_access_allowlist a
        where a.role = 'responder' and a.responder_label = v_responder
      )
      and not exists (
        select 1 from auth.users u
        where u.raw_app_meta_data->>'unask_role' = 'responder'
          and u.raw_app_meta_data->>'responder_label' = v_responder
      ) then
      raise exception 'The selected responder is not configured';
    end if;
    update public.questions
    set status = 'Assigned', responder_label = v_responder, updated_at = now()
    where id = p_question_id
      and moderation_state = 'active'
      and status in ('Under review', 'Needs clarification');
  elsif p_action = 'close' then
    update public.questions
    set status = 'Closed', responder_label = null, updated_at = now()
    where id = p_question_id and moderation_state = 'active';
  elsif p_action in ('hide', 'delete', 'restore') then
    update public.questions
    set moderation_state = case
          when p_action = 'hide' then 'hidden'
          when p_action = 'delete' then 'deleted'
          else 'active'
        end,
        moderated_at = now(),
        updated_at = now()
    where id = p_question_id;
  else
    raise exception 'Invalid moderation action';
  end if;

  get diagnostics v_changed = row_count;
  if v_changed = 0 then raise exception 'Question not found'; end if;

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
  v_role text := private.current_staff_role();
  v_label text := case
    when private.current_staff_role() = 'hr' then 'People Team · HR'
    else private.current_responder_label()
  end;
  v_changed bigint;
begin
  if not public.is_everstage_user()
    or v_role not in ('hr', 'responder')
    or v_label is null then
    raise exception 'Responder access is required';
  end if;
  if char_length(v_answer) not between 1 and 8000 then
    raise exception 'Answer must be between 1 and 8000 characters';
  end if;

  update public.questions
  set status = 'Answered', answer = v_answer, updated_at = now()
  where id = p_question_id
    and moderation_state = 'active'
    and status = 'Assigned'
    and responder_label = v_label;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then raise exception 'Assigned question not found'; end if;

  insert into private.question_audit_events (
    question_id, actor_user_id, action, details
  ) values (
    p_question_id,
    (select auth.uid()),
    'answer_published',
    jsonb_build_object('responder_label', v_label)
  );
end;
$$;

create or replace function public.get_unask_analytics(p_period text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, private, public
as $$
declare
  v_result jsonb;
  v_bucket text := case when p_period = 'month' then 'month' else 'week' end;
begin
  if not public.is_everstage_user()
    or (select auth.uid()) is null
    or private.current_staff_role() <> 'hr' then
    raise exception 'HR access is required';
  end if;

  with active_questions as (
    select q.* from public.questions q where q.moderation_state = 'active'
  ), answer_times as (
    select extract(epoch from (min(a.created_at) - q.created_at)) / 3600.0 hours
    from active_questions q
    join private.question_audit_events a
      on a.question_id = q.id and a.action = 'answer_published'
    group by q.id, q.created_at
  ), trend as (
    select date_trunc(v_bucket, q.created_at) bucket, count(*) count
    from active_questions q
    where q.created_at >= now() - case when v_bucket = 'month' then interval '12 months' else interval '12 weeks' end
    group by 1 order by 1
  )
  select jsonb_build_object(
    'total', (select count(*) from active_questions),
    'answered', (select count(*) from active_questions where status = 'Answered'),
    'pending', (select count(*) from active_questions where status not in ('Answered', 'Closed')),
    'average_answer_hours', coalesce((select round(avg(hours)::numeric, 1) from answer_times), 0),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('period', bucket, 'count', count)) from trend), '[]'::jsonb),
    'most_liked', coalesce((select jsonb_build_object('id', id, 'question', question, 'value', upvotes) from active_questions order by upvotes desc, id desc limit 1), '{}'::jsonb),
    'most_disliked', coalesce((select jsonb_build_object('id', id, 'question', question, 'value', dislikes) from active_questions order by dislikes desc, id desc limit 1), '{}'::jsonb),
    'most_discussed', coalesce((select jsonb_build_object('id', id, 'question', question, 'value', comments_count) from active_questions order by comments_count desc, id desc limit 1), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_unask_question_thread(
  p_question_id bigint,
  p_thread_hash text
)
returns table (
  id bigint, question text, detail text, status public.question_status,
  visibility public.question_visibility, display_name text, upvotes integer,
  dislikes integer, comments_count integer, responder_label text, answer text,
  private_reply text, employee_reply text, employee_reply_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, private, public
as $$
  select q.id, q.question, q.detail, q.status, q.visibility, q.display_name,
    q.upvotes, q.dislikes, q.comments_count, q.responder_label, q.answer,
    t.private_reply, t.employee_reply, t.employee_reply_at, q.created_at, q.updated_at
  from public.questions q
  join private.question_threads t on t.question_id = q.id
  where public.is_everstage_user()
    and (select auth.uid()) is not null
    and q.moderation_state = 'active'
    and q.id = p_question_id
    and p_thread_hash ~ '^[0-9a-f]{64}$'
    and t.token_hash = p_thread_hash;
$$;

revoke all on function public.get_unask_analytics(text) from public, anon;
grant execute on function public.get_unask_analytics(text) to authenticated;

comment on column public.questions.moderation_state
  is 'Active questions are visible normally; hidden and soft-deleted questions remain available only to HR for scrutiny.';
comment on function public.get_unask_analytics(text)
  is 'Returns aggregate HR analytics without sender identity or authentication data.';
