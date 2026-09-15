-- Make HR assignment safe to retry. A rapid double click or a network retry must
-- not turn a successful first assignment into a misleading client-side error.

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

    -- A repeated call for the same completed assignment is a successful no-op.
    if exists (
      select 1
      from public.questions q
      where q.id = p_question_id
        and q.moderation_state = 'active'
        and q.status = 'Assigned'
        and q.responder_label = v_responder
    ) then
      return;
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

comment on function public.moderate_unask_question(bigint, text, text, text)
  is 'Performs HR moderation; identical assignment retries are idempotent.';
