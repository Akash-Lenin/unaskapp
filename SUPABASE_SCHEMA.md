# Unask Supabase Schema

Project: `kykvxhbinrduankuvplm`

## Data boundary

- `public.questions` stores feedback content and aggregate counters. Anonymous rows do not store an employee user ID or email.
- `public.question_thoughts` stores anonymous follow-up thoughts. It deliberately has no author, email, user ID, or fingerprint column.
- `private.question_threads` is reserved for hashed thread capabilities and private replies. It is not exposed to anonymous or authenticated clients.
- `private.staff_roles` stores identities only for HR moderators and named responders.
- `private.question_audit_events` stores staff moderation events only. Employee submissions and votes must never be written here.

## Access rules

- All four support tables have RLS enabled.
- Only verified `@everstage.com` sessions may read or add published thoughts.
- HR sessions may hide or republish thoughts using the existing trusted `app_metadata.unask_role` claim.
- `anon` has no table privileges.
- Browser-authenticated users have no privileges on any `private` table.
- `service_role` is the only application role granted access to private tables and must remain server-side.

## Operational notes

- `private.staff_roles` is currently additive; existing question policies still use trusted Auth app metadata. Switching authorization to the table should be a separately reviewed migration so existing moderators are not locked out.
- `private.question_threads` is ready for the next backend/RPC slice. The current question submission path still writes the SHA-256 thread-token hash to the protected `public.questions.thread_key` intake column.
- `private.question_audit_events` is ready for staff-workflow triggers. No employee action should create an audit event.
- `questions.comments_count` is not yet synchronized from `question_thoughts`; add that trigger when the UI starts using the thoughts table.
