# Unask operations runbook

## Monitoring

- Continuously check `GET /api/health` from an external uptime service every five minutes.
- Alert after two consecutive failures. Do not send question bodies, recovery codes, emails, access tokens, or request headers to monitoring tools.
- Watch Railway deploy failures, restart loops, response latency, and 5xx rate. Watch Supabase database, Auth, and API health separately.
- Treat unusual bursts in submissions, reports, or failed capability checks as possible abuse without attempting to identify a sender.

## Incident response

1. Confirm whether the fault affects sign-in, reading, submission, or staff workflows.
2. Preserve platform logs with restricted access. Never paste recovery codes or feedback text into tickets or chat.
3. If a deployment caused the fault, roll Railway back to the last healthy deployment and verify `/api/health`, Google sign-in, one read, and one non-production test submission.
4. If database changes caused the fault, prefer a forward migration. Never delete or rewrite production feedback as part of a rollback.
5. For suspected identity exposure, stop new submissions, restrict log access, preserve evidence, and notify the privacy/security owner before resuming service.

## Release checklist

- `npm run build`
- Test employee, HR, and responder roles with approved test accounts.
- Test recovery on a separate browser profile using a disposable test question.
- Test clarification reply, thought hide/restore/delete, reporting, voting, and pagination.
- Confirm no email, user ID, recovery code, or raw thread token is stored on question/thought rows or written to application logs.
