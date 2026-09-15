# Anonymity and correlation test plan

Use disposable test content and two approved employee accounts.

1. Submit questions close together and verify HR/responder screens, database question rows, exports, and UI never expose account identity.
2. Refresh, sign out/in, open a new tab, and restore on another device. Ownership must return only with the recovery code.
3. Try a wrong recovery code and a valid Google login without the code. Neither may reveal owned private threads.
4. Verify recovery vault rows contain only a vault hash, salt, IV, ciphertext, version, and timestamps—never email, user ID, thread token, or plaintext.
5. Verify employee clarification requires the thread capability and that audit events do not record the employee user ID.
6. Review Google, Railway, Supabase Auth, API, database, proxy, and monitoring logs for timing/IP/user-agent correlation. Record every remaining metadata source.
7. Repeat with submissions delayed and batched. Confirm operational staff cannot infer authorship from application data alone.

Passing this plan demonstrates application-layer separation. It does not prove protection against a platform operator who can correlate authentication, network, and database timing; that requires the later blind-token submission architecture.
