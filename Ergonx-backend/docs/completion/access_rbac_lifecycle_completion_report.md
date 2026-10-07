# Access, RBAC, onboarding, and lifecycle increment

Completed: 2026-09-16

This increment adds tenant-selected authentication bootstrap, custom-role management, protected system-role semantics, permission classification, membership controls with a last-admin guard, server-derived institution onboarding validation, employee onboarding/offboarding actions, recruitment onboarding handoff, and institution-only membership deactivation.

The frontend contracts are in `docs/integration/access_rbac_frontend_contract.md`, `institution_onboarding_frontend_contract.md`, and `employee_lifecycle_frontend_contract.md`. Shared Home, search, settings, and reference contracts are documented alongside them.

Deliberately still open: expiring single-use invitation acceptance and a service-backed rehire flow. These are recorded under `ACCESS-001` in the development limitations register. No public signup, SSO/MFA, multi-role memberships, ABAC engine, or microservice split was introduced.
