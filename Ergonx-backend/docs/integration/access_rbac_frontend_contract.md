# Access and RBAC frontend contract

`GET /api/v1/auth/bootstrap/` is the post-login source of truth for active tenant context, permission codes, enabled modules, onboarding readiness, landing key, and dashboards. `/auth/me/` remains a profile-only endpoint.

Institution administrators manage roles through `/api/v1/institutions/roles/` and `/roles/clone/`; permissions are listed at `/permissions/`. System/reserved roles are readable but cannot be edited. Custom roles may use only existing non-platform-only permissions. Memberships are listed and safely patched through `/api/v1/institutions/members/`; the server rejects removal or reassignment of the final active Institution Admin with `last_required_admin`.

The UI must render navigation from bootstrap permissions and enabled modules, then still handle `403`, `module_disabled`, and `tenant_mismatch` responses. A membership has one role; do not model a client-side multi-role assignment.
