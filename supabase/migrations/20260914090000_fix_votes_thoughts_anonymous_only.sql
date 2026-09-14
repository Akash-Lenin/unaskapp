create table if not exists private.question_vote_baselines (
  question_id bigint primary key references public.questions(id) on delete cascade,
  upvotes integer not null default 0 check (upvotes >= 0),
  dislikes integer not null default 0 check (dislikes >= 0)
);

insert into private.question_vote_baselines (question_id, upvotes, dislikes)
select id, upvotes, dislikes
from public.questions
on conflict (question_id) do nothing;

create table if not exists private.question_votes (
  question_id bigint not null references public.questions(id) on delete cascade,
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  direction text not null check (direction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, voter_hash)
);

alter table private.question_vote_baselines enable row level security;
alter table private.question_votes enable row level security;

revoke all on private.question_vote_baselines from public, anon, authenticated;
revoke all on private.question_votes from public, anon, authenticated;
grant all on private.question_vote_baselines to service_role;
grant all on private.question_votes to service_role;

create or replace function public.set_unask_vote(
  p_question_id bigint,
  p_direction text
)
returns table (upvotes integer, dislikes integer, my_vote text)
language plpgsql
security definer
set search_path = pg_catalog, private, public, extensions
as $$
declare
  v_voter_hash text;
  v_previous_direction text;
  v_baseline_upvotes integer;
  v_baseline_dislikes integer;
begin
  if not public.is_everstage_user() or (select auth.uid()) is null then
    raise exception 'Verified Everstage access is required';
  end if;
  if p_direction not in ('up', 'down') then
    raise exception 'Invalid vote direction';
  end if;

  perform 1
  from public.questions q
  where q.id = p_question_id
    and q.status in ('Assigned', 'Answered')
  for update;
  if not found then
    raise exception 'Published question not found';
  end if;

  insert into private.question_vote_baselines (question_id, upvotes, dislikes)
  select q.id, q.upvotes, q.dislikes
  from public.questions q
  where q.id = p_question_id
  on conflict (question_id) do nothing;

  v_voter_hash := encode(
    extensions.digest((select auth.uid())::text || ':' || p_question_id::text, 'sha256'),
    'hex'
  );

  select qv.direction
  into v_previous_direction
  from private.question_votes qv
  where qv.question_id = p_question_id
    and qv.voter_hash = v_voter_hash;

  if v_previous_direction = p_direction then
    delete from private.question_votes qv
    where qv.question_id = p_question_id
      and qv.voter_hash = v_voter_hash;
    my_vote := null;
  elsif v_previous_direction is null then
    insert into private.question_votes (question_id, voter_hash, direction)
    values (p_question_id, v_voter_hash, p_direction);
    my_vote := p_direction;
  else
    update private.question_votes qv
    set direction = p_direction, updated_at = now()
    where qv.question_id = p_question_id
      and qv.voter_hash = v_voter_hash;
    my_vote := p_direction;
  end if;

  select b.upvotes, b.dislikes
  into v_baseline_upvotes, v_baseline_dislikes
  from private.question_vote_baselines b
  where b.question_id = p_question_id;

  select
    v_baseline_upvotes + count(*) filter (where qv.direction = 'up')::integer,
    v_baseline_dislikes + count(*) filter (where qv.direction = 'down')::integer
  into upvotes, dislikes
  from private.question_votes qv
  where qv.question_id = p_question_id;

  update public.questions q
  set upvotes = set_unask_vote.upvotes,
      dislikes = set_unask_vote.dislikes
  where q.id = p_question_id;

  return next;
end;
$$;

create or replace function public.list_my_unask_votes()
returns table (question_id bigint, direction text)
language sql
stable
security definer
set search_path = pg_catalog, private, public, extensions
as $$
  select qv.question_id, qv.direction
  from private.question_votes qv
  where public.is_everstage_user()
    and (select auth.uid()) is not null
    and qv.voter_hash = encode(
      extensions.digest((select auth.uid())::text || ':' || qv.question_id::text, 'sha256'),
      'hex'
    );
$$;

create or replace function public.submit_unask_thought(
  p_question_id bigint,
  p_body text
)
returns table (
  id bigint,
  question_id bigint,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_thought public.question_thoughts%rowtype;
begin
  if not public.is_everstage_user() then
    raise exception 'Verified Everstage access is required';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'Thought must be between 1 and 2000 characters';
  end if;
  if not exists (
    select 1 from public.questions q
    where q.id = p_question_id
      and q.status in ('Assigned', 'Answered')
  ) then
    raise exception 'Published question not found';
  end if;

  insert into public.question_thoughts (question_id, body, status)
  values (p_question_id, v_body, 'published')
  returning * into v_thought;

  return query
  select v_thought.id, v_thought.question_id, v_thought.body, v_thought.created_at;
end;
$$;

create or replace function private.sync_question_thought_count()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'INSERT' then
    update public.questions q
    set comments_count = (
      select count(*)::integer
      from public.question_thoughts qt
      where qt.question_id = old.question_id
        and qt.status = 'published'
    )
    where q.id = old.question_id;
  end if;

  if tg_op <> 'DELETE' then
    update public.questions q
    set comments_count = (
      select count(*)::integer
      from public.question_thoughts qt
      where qt.question_id = new.question_id
        and qt.status = 'published'
    )
    where q.id = new.question_id;
  end if;

  return null;
end;
$$;

drop trigger if exists sync_question_thought_count on public.question_thoughts;
create trigger sync_question_thought_count
after insert or update of question_id, status or delete
on public.question_thoughts
for each row execute function private.sync_question_thought_count();

update public.questions q
set comments_count = (
  select count(*)::integer
  from public.question_thoughts qt
  where qt.question_id = q.id
    and qt.status = 'published'
);

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
  if p_visibility <> 'anonymous' or nullif(btrim(coalesce(p_display_name, '')), '') is not null then
    raise exception 'Named submissions are no longer supported';
  end if;
  if p_thread_hash is null or p_thread_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid thread capability';
  end if;

  insert into public.questions (
    question, detail, visibility, display_name, thread_key
  ) values (
    v_question_text, v_detail_text, 'anonymous', null, null
  )
  returning * into v_question;

  insert into private.question_threads (question_id, token_hash)
  values (v_question.id, p_thread_hash);

  insert into private.question_vote_baselines (question_id, upvotes, dislikes)
  values (v_question.id, 0, 0);

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

revoke all on function public.set_unask_vote(bigint, text) from public, anon;
revoke all on function public.list_my_unask_votes() from public, anon;
revoke all on function public.submit_unask_thought(bigint, text) from public, anon;
revoke all on function private.sync_question_thought_count() from public, anon, authenticated;

grant execute on function public.set_unask_vote(bigint, text) to authenticated;
grant execute on function public.list_my_unask_votes() to authenticated;
grant execute on function public.submit_unask_thought(bigint, text) to authenticated;

revoke execute on function public.vote_question(bigint, text) from authenticated;

comment on function public.set_unask_vote(bigint, text)
  is 'Toggles or changes one pseudonymous vote per authenticated employee and question.';
comment on function public.list_my_unask_votes()
  is 'Returns only the current employee session voting state without exposing identity or other voters.';
comment on function public.submit_unask_thought(bigint, text)
  is 'Adds a published anonymous thought to a published question without storing author identity.';
comment on function public.submit_unask_question(text, text, text, text, text)
  is 'Creates anonymous-only feedback and stores its capability hash only in the private schema.';
