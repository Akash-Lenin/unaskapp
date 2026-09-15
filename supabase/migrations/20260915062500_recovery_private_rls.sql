-- Make the intentionally closed private tables explicit to the database advisor.

create policy recovery_vaults_no_browser_access
on private.recovery_vaults
for all
to anon, authenticated
using (false)
with check (false);

create policy content_reports_no_browser_access
on private.content_reports
for all
to anon, authenticated
using (false)
with check (false);
