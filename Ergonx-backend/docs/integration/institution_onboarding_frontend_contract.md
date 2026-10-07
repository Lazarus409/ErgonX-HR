# Institution onboarding frontend contract

Use `GET /api/v1/institutions/onboarding/` with `onboarding.view` to render the authoritative ordered steps, status, percentage, and blocker messages. `POST` on the same route requires `onboarding.manage` and performs server validation; it does not blindly accept a client-completed checklist.

Step completion is derived from institution profile, enabled modules, organization records, module readiness, and active administrator checks. Disabled optional modules are marked `SKIPPED`; blockers provide a stable code/message. Refresh `/auth/bootstrap/` after validation because `onboarding_ready` and the default experience may change.
