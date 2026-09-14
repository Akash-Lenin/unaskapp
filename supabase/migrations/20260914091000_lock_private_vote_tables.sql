create policy question_vote_baselines_no_browser_access
on private.question_vote_baselines
for all
to anon, authenticated
using (false)
with check (false);

create policy question_votes_no_browser_access
on private.question_votes
for all
to anon, authenticated
using (false)
with check (false);
