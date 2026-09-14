# Unask — Session Context Export

Exported: 2026-09-13 (Asia/Kolkata)

## Purpose

This document is a self-contained handoff for the Unask anonymous workplace feedback application. It records the user-visible goals, recovered project state, current functionality, implementation structure, validation results, deployment state, and useful continuation notes from this session.

It intentionally excludes credentials, authentication tokens, hidden system instructions, and private reasoning.

## User Request

The user asked to resume the previous session for the Unask app. The existing workspace was inspected and restored rather than replaced.

The workspace already contained a coherent anonymous-feedback prototype and generated build output, but it did not initially contain Git history or a linked Sites project identifier.

## Product Summary

Unask is a role-aware workplace question-and-response prototype designed to let employees raise questions without attaching their identity.

The experience demonstrates three roles:

- **Employee:** submits anonymous questions, searches and filters the shared feed, votes, adds anonymous thoughts, and reads published answers.
- **HR Admin:** reviews open questions, sees engagement signals, categorizes questions, and assigns them to an appropriate responder without access to sender identity.
- **Responder:** sees only assigned questions and publishes official answers to the employee feed.

The employee feed, anonymous question submission, and voting are connected to Supabase project `kykvxhbinrduankuvplm`. Access now requires a verified Supabase Auth session for an exact `@everstage.com` email, enforced again by database RLS. Feedback records contain no email or employee ID. The HR and responder screens remain role-preview UI until production SSO issues trusted staff claims.

## Current User Experience

### Global role preview

The header provides a **Preview as** control for switching among Employee, HR Admin, and Responder views. A persistent privacy strip explains that a production version would use SSO to assign roles while keeping identity detached from feedback.

### Employee workflow

- View seeded questions in a shared feed.
- Filter by All, Open, or Answered.
- Search question text and categories.
- Select a question to inspect its answer or response status.
- Upvote or downvote a question once, change the vote, or toggle it off.
- Open a question's thoughts, read them, and add an anonymous thought.
- Open the anonymous question composer.
- Submit a new anonymous question. To identify themselves voluntarily, employees can include a name in the message body.
- Receive an on-screen success confirmation.

### Privacy guidance in the composer

The composer performs a local pattern check for phrases that may make a sender identifiable, including:

- References to being the only person in a group.
- Specific reporting relationships such as “my manager” or “my skip.”
- Precise personal events such as “when I joined.”
- Small regional groups such as India, EMEA, APAC, Seattle, or Bangalore teams.

The check warns the user but does not block submission. The UI states that name, email, IP address, and device information are not attached. This is prototype copy, not yet backed by production infrastructure.

### HR Admin workflow

- Review questions that are not yet answered.
- See operational summary metrics.
- Inspect question context and engagement.
- See explicit identity-redaction messaging.
- Review category options.
- Assign a question to a responder.

### Responder workflow

- View questions assigned to the sample responder, Maya.
- Inspect the question and its anonymous engagement context.
- Draft and publish an official answer.
- See an empty state when no assigned questions remain.

## Seeded Demonstration Content

The prototype includes sample questions about:

- Promotion criteria and review timelines.
- Territory-change reasoning.
- Recognition for behind-the-scenes work.
- A reliable source for pricing and competitor guidance.

The supported categories are Career growth, Ways of working, Recognition, and Enablement. The sample responders are Maya from People Leadership, Arjun from Revenue Operations, and Leena from Enablement.

## Visual Direction

The interface uses a warm editorial workplace aesthetic:

- Warm paper background and white cards.
- Dark ink typography.
- Orange as the primary action accent.
- Teal for privacy and trust signals.
- Plum for deeper contrast.
- Compact uppercase orientation labels.
- Fine borders, restrained rounded corners, and dense product-focused layouts.

The layout is responsive and includes mobile adaptations in the shared stylesheet.

## Implementation

### Stack

- React 19
- TypeScript
- Vinext/Vite
- Tailwind CSS 4
- shadcn-based UI components
- Lucide icons
- Cloudflare Worker-compatible Sites output

### Important files

- `app/page.tsx` — complete prototype logic and the three role experiences.
- `app/globals.css` — design tokens, product styling, layouts, responsive behavior, and older retained styles from preceding iterations.
- `app/layout.tsx` — page metadata and social-preview configuration.
- `public/og.png` — preserved social-preview image.
- `public/favicon.svg` — site favicon.
- `.openai/hosting.json` — Sites project linkage; no D1 or R2 bindings are configured.
- `package.json` — development, build, lint, and formatting commands.

### State model

The main page stores questions, selected question, role, composer state, filters, votes, draft text, assignment actions, and published answers in React `useState` values.

Question records currently include:

- Numeric ID
- Question and context
- Category
- Status: Under review, Assigned, or Answered
- Relative age
- Upvotes, dislikes, and thought count
- Optional responder
- Optional official answer

## Work Completed in This Session

1. Inspected and recovered the existing Unask workspace.
2. Confirmed the project was an existing Sites/Vinext application.
3. Verified the full production build succeeds.
4. Started and verified a local development response with HTTP 200.
5. Attempted to restore the in-chat browser preview; no browser surface was available in the current session.
6. Created a private Sites project for the restored application.
7. Initialized local Git history because the recovered workspace did not contain a repository.
8. Saved and uploaded the validated source.
9. Published the application privately.
10. Updated the metadata base URL to the deployed Unask origin.
11. Rebuilt, saved, and redeployed the final metadata-corrected version.

## Supabase Continuation

1. Connected and verified Supabase project `kykvxhbinrduankuvplm` as active and healthy.
2. Added and seeded the durable `public.questions` data source.
3. Restricted public reads to assigned and answered questions.
4. Restricted anonymous inserts to clean, under-review records without administrative fields.
5. Added guarded, persistent voting for public questions.
6. Added trusted HR and responder RLS paths based on server-controlled app metadata.
7. Prevented public access to private thread and clarification fields.
8. Fixed all Supabase security-advisor findings.
9. Connected the React employee feed, submission flow, and voting to Supabase.
10. Updated the canonical metadata origin to the Railway deployment.
11. Replaced the simulated login with passwordless email verification.
12. Enforced the Everstage email domain in both the client gate and database RLS.
13. Switched anonymous thread secrets to client-generated SHA-256 hashes; raw recovery keys remain only in the browser tab.
14. Added the anonymous-feedback support schema: public thoughts plus private thread, staff-role, and staff-audit tables.
15. Added explicit grants, RLS, constraints, foreign-key indexes, and schema comments for those tables.
16. Replaced passwordless email links with Google OAuth for Everstage Workspace accounts.
17. Tightened database access to require both an exact `@everstage.com` email and a server-issued Google provider claim.

## Deployment

Private live URL:

https://unaskapp-production.up.railway.app/

The latest deployment completed successfully. The linked Sites project is recorded locally in `.openai/hosting.json`.

## Validation

- `npm run build` completed successfully after the final source change.
- The local root route returned HTTP 200.
- The final Sites deployment reported a successful production state.
- The metadata base URL now points to the deployed site, so social-preview paths resolve against the correct origin.

Vinext emitted a non-blocking deprecation warning about Node's `module.register()` and noted that some route classification remains unknown. Neither warning prevented the build or deployment.

Browser-based visual QA was not performed because no in-app or connected browser was available. The successful build, local HTTP response, and deployment were still verified.

## Git State

Local Git history was initialized during recovery.

Recorded commits:

- `976521b` — Resume Unask anonymous feedback app.
- `ccc1628` — Use deployed URL for social metadata.

The Sites source branch contains the final commit.

## Durable Staff Workflow Update (2026-09-14)

- Connected HR clarification, closure, and assignment actions to Supabase.
- Connected responder answer publication to Supabase.
- Replaced the unrestricted role-preview selector with role-aware navigation derived from trusted staff authorization.
- Moved anonymous thread hashes and private replies out of `public.questions` into `private.question_threads`.
- Added capability-based author thread recovery without storing author identity.
- Added private audit events for HR and responder actions.
- Revoked browser-side direct inserts and updates on questions; guarded RPCs now own those writes.
- Added the migration in `supabase/migrations/20260914060040_durable_staff_workflows.sql`.

## Known Gaps and Risks

- Staff identities still need to be assigned to `private.staff_roles` before HR and responder workspaces appear for those users.
- Google OAuth is implemented in the app and RLS. The Supabase Google provider still requires a Google OAuth client ID and secret, plus the Railway redirect URL, before live sign-in can complete.
- Anonymous submission rows do not store employee identity, and public database access excludes private thread fields. The complete anonymity threat model still needs formal review.
- Existing questions created without a recovery capability cannot receive a private clarification; they can still be assigned or closed.
- There is no rate limiting, abuse prevention, notification system, or analytics pipeline.
- The privacy phrase detection is regex-based and intentionally lightweight.
- The visible product and metadata now use **Unask**.
- The shared stylesheet retains styles from earlier interface concepts that are not all used by the current page.

## Recommended Next Product Slice

The highest-value next step is to convert the prototype into a durable, role-secured application:

1. Confirm whether the visible brand should be **Unask** everywhere.
2. Define the production anonymity model and threat boundaries before collecting real feedback.
3. Assign trusted HR/responder roles to the intended Everstage accounts.
4. Add moderation and abuse safeguards.
5. Run browser-based visual and interaction QA across desktop and mobile.

## How to Resume Development

From the project directory:

```bash
npm run dev
```

For a production validation build:

```bash
npm run build
```

Continue from the existing source and project linkage. Do not create another Sites project for this checkout; reuse the project recorded in `.openai/hosting.json`.

## Safe Context Prompt for a Future Session

> Resume the Unask anonymous-feedback app from `UNASK_SESSION_CONTEXT.md`. Preserve the existing Sites project and visual language. Review the known gaps, confirm the requested next product slice, implement it, validate the build, and publish the updated private site.
