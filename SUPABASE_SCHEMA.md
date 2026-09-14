# Unask Supabase Schema

Project: `kykvxhbinrduankuvplm`

## Data boundary

- `public.questions` stores feedback content and aggregate counters. Anonymous rows do not store an employee user ID, email, thread capability, or private reply.
- `public.question_thoughts` stores anonymous follow-up thoughts. It deliberately has no author, email, user ID, or fingerprint column.
- `private.question_threads` stores hashed thread capabilities and private replies. Authors recover only their own thread by presenting the matching capability through a guarded RPC.
- `private.staff_roles` stores identities only for HR moderators and named responders.
- `private.question_audit_events` stores staff moderation events only. Employee submissions and votes must never be written here.
- `private.question_votes` stores one per-question pseudonymous vote marker and direction. It stores no email or employee ID and is never exposed to browser roles.
- `private.question_vote_baselines` preserves aggregate totals that existed before individual vote state was introduced.
- `private.test_access_allowlist` stores approved testing emails and their app role. It is private access-control data and is not joined to questions, thoughts, or votes.

## Access rules

- All four support tables have RLS enabled.
- Google-authenticated sessions may enter with an exact `@everstage.com` email or an exact email in the private testing allowlist.
- Staff access is resolved from `private.staff_roles`, with trusted `app_metadata` retained as a migration-compatible fallback.
- HR moderation, assignment, clarification, and closure run through guarded RPCs and create private audit events.
- Responders can publish only answers assigned to their configured responder label.
- `anon` has no table privileges.
- Browser-authenticated users have no privileges on any `private` table.
- `service_role` is the only application role granted access to private tables and must remain server-side.

## Operational notes

- Add staff by writing an Everstage Auth user ID and role to `private.staff_roles`. Responders also require a unique, human-readable `responder_label` that HR can assign to questions.
- Add temporary external testers to `private.test_access_allowlist` with an exact lowercase Google email and the `employee`, `hr`, or `responder` role. Responder entries also require a unique `responder_label`.
- Question submission, voting, and thought creation use explicitly granted RPCs. Direct inserts and updates on `public.questions` are denied to browser sessions.
- New questions are always anonymous. The historic visibility and display-name columns remain for schema compatibility, but the submission RPC rejects named submissions.
- Votes toggle on/off and may be changed between up and down; each employee can have at most one vote per question.
- Employee submissions and votes never create staff audit events.
- `questions.comments_count` is synchronized from published `question_thoughts` by a database trigger.

## Durable workflow RPCs

- `submit_unask_question` creates a question and its private recovery thread atomically.
- `get_unask_question_thread` returns a single author thread only for a matching SHA-256 capability hash.
- `get_staff_profile` resolves the signed-in user's trusted staff role.
- `list_unask_responders` returns configured responders to HR only.
- `moderate_unask_question` performs audited clarification, assignment, and closure actions for HR.
- `publish_unask_answer` performs audited answer publication for the assigned responder.
- `set_unask_vote` toggles or changes the current employee's pseudonymous vote.
- `list_my_unask_votes` restores only the current employee's vote state.
- `submit_unask_thought` adds an anonymous thought to a published question.
