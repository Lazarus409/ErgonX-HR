# Recruitment / ATS MVP completion report

Status: COMPLETE WITH DOCUMENTED LIMITATIONS - ready for release-candidate/integration mode (2026-09-13).

## Delivered scope

- ERD entities: JobPosting, Candidate, Application, RecruitmentStage, ApplicationStageHistory, Interview, CandidateEvaluation, and Offer.
- Tenant-scoped models, foreign-key validation, database constraints and indexes.
- RECRUITMENT module gate, granular role permissions, DRF APIs, search/filter/order support, and automatic envelope/OpenAPI descriptions.
- Explicit service-backed status actions with audit events and in-app workflow notifications.
- Shared Document linking for candidate documents.
- Atomic, idempotent Offer-to-Employee conversion using `Employee`, `Employment`, and optional `EmployeeCompensation`.
- Development-only deterministic demo command: `python manage.py seed_recruitment_demo`.

## Verification evidence

- PostgreSQL migrations applied: `institutions.0022_seed_recruitment_access` and `recruitment.0001_initial`.
- Focused PostgreSQL tests: `4 passed` (`tests/test_recruitment.py`), covering state transitions, tenant/module/RBAC access, Documents linkage, status-PATCH protection, hire idempotency, and rollback.
- Full PostgreSQL regression: `126 passed in 170.89s`.
- `python manage.py check` and `makemigrations --check --dry-run` are clean.
- OpenAPI generated successfully and includes all Recruitment paths, including candidate-scoped Documents.
- `python manage.py seed_recruitment_demo` ran twice in development with the same deterministic result.

## Release-candidate boundaries

The final feature-development module is complete. Remain in integration, QA, security-review, documentation, and demo mode until a new, explicitly approved roadmap stage is opened. The retained limitations are `RECRUIT-001` and `RECRUIT-002` in the development register.
