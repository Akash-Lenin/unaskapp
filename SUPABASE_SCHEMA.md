# Unask Supabase Schema

Project: `kykvxhbinrduankuvplm`

## Data boundary

- `public.questions` stores feedback content and aggregate counters. Anonymous rows do not store an employee user ID, email, thread capability, or private reply.
- `public.question_thoughts` stores anonymous follow-up thoughts. It deliberately has no author, email, user ID, or fingerprint column.
- `private.question_threads` stores hashed thread capabilities and private replies. Authors recover only their own thread by presenting the matching capability through a guarded RPC.
- `private.staff_roles` stores identities only for HR moderators and named responders.
- `private.question_audit_events` stores staff moderation events only. Employee submissions and votes must never be written here.

## Access rules

- All four support tables have RLS enabled.
- Only Google-authenticated sessions with an exact `@everstage.com` email may access Unask data or add published thoughts.
- Staff access is resolved from `private.staff_roles`, with trusted `app_metadata` retained as a migration-compatible fallback.
- HR moderation, assignment, clarification, and closure run through guarded RPCs and create private audit events.
- Responders can publish only answers assigned to their configured responder label.
- `anon` has no table privileges.
- Browser-authenticated users have no privileges on any `private` table.
- `service_role` is the only application role granted access to private tables and must remain server-side.

## Operational notes

- Add staff by writing an Everstage Auth user ID and role to `private.staff_roles`. Responders also require a unique, human-readable `responder_label` that HR can assign to questions.
- Question submission and voting use explicitly granted RPCs. Direct inserts and updates on `public.questions` are denied to browser sessions.
- Employee submissions and votes never create staff audit events.
- `questions.comments_count` is not yet synchronized from `question_thoughts`; add that trigger when the UI starts using the thoughts table.

## Durable workflow RPCs

- `submit_unask_question` creates a question and its private recovery thread atomically.
- `get_unask_question_thread` returns a single author thread only for a matching SHA-256 capability hash.
- `get_staff_profile` resolves the signed-in user's trusted staff role.
- `list_unask_responders` returns configured responders to HR only.
- `moderate_unask_question` performs audited clarification, assignment, and closure actions for HR.
- `publish_unask_answer` performs audited answer publication for the assigned responder.
