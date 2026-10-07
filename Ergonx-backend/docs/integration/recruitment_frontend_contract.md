# Recruitment / ATS frontend integration contract

Status: MVP delivery contract. API namespace: `/api/v1/`.

## Access and response rules

Every endpoint requires JWT authentication, an active institution context (normally `X-Institution-ID`), the `RECRUITMENT` institution module enabled, and the listed permission. Results are restricted to the selected institution. The standard ErgonX envelope is used: successful payloads are in `data`; failures contain `success: false`, `code`, `message`, and `errors`.

Never infer authorization from a hidden control. Display a module-disabled or permission-denied state for `403` responses. Use UUIDs exactly as returned by the API.

## Resources and permissions

| Resource | Endpoint | Read | Write |
|---|---|---|---|
| Job postings | `/recruitment/job-postings/` | `job_posting.view` | `job_posting.create`, `job_posting.update` |
| Candidates and applications | `/recruitment/candidates/`, `/recruitment/applications/` | `candidate.view` | `candidate.create`, `candidate.update` |
| Pipeline stages | `/recruitment/stages/` | `recruitment_stage.view` | `recruitment_stage.manage` |
| Interviews | `/recruitment/interviews/` | `interview.view` | `interview.manage` |
| Evaluations | `/recruitment/evaluations/` | `interview.view` | `candidate_evaluation.create` |
| Offers | `/recruitment/offers/` | `offer.view` | `offer.create`, `offer.manage` |

List endpoints accept the usual `search`, `ordering`, `page`, and `page_size` parameters plus their documented filters. Use server-side filtering; do not aggregate cross-tenant data client-side.

## Workflow actions

Status fields are read-only in ordinary creates and PATCHes. The frontend must use the action endpoints below and refresh the returned resource.

| Workflow | Action | Request body |
|---|---|---|
| Publish/close/cancel posting | `POST /recruitment/job-postings/{id}/publish/`, `/close/`, `/cancel/` | none |
| Submit application | `POST /recruitment/applications/{id}/submit/` | none |
| Move application | `POST /recruitment/applications/{id}/move-stage/` | `{ "stage": "uuid", "comment": "optional" }` |
| Withdraw/reject application | `POST .../{id}/withdraw/`, `/reject/` | rejection accepts `{ "reason": "optional" }` |
| Complete/cancel/no-show interview | `POST /recruitment/interviews/{id}/set-status/` | `{ "status": "COMPLETED|CANCELLED|NO_SHOW" }` |
| Extend/accept/decline/withdraw offer | `POST /recruitment/offers/{id}/extend/`, `/accept/`, `/decline/`, `/withdraw/` | none |
| Convert candidate to employee | `POST /recruitment/offers/{id}/hire/` | `{ "employee_number": "EMP-123" }` |

The hire action is idempotent: a repeat request returns the employee already created for that offer. Present the returned `employee_id` as a link to the existing Employee domain. Do not create an employee, employment, or compensation record independently for an accepted offer.

## Pipeline, documents, and lifecycle display

- `GET /recruitment/applications/pipeline/` returns stage cards with `stage_id`, `stage_name`, `sequence`, and `application_count`.
- `GET /recruitment/applications/{id}/stage-history/` provides immutable stage transitions.
- `GET /recruitment/candidates/{id}/scorecard/` returns `average_score` and `application_count`.
- Candidate files use the shared Documents API: create/list `/documents/` records with `entity_type: "recruitment.Candidate"` and `entity_id` set to the candidate UUID. `GET /recruitment/candidates/{id}/documents/` is the candidate-scoped read convenience endpoint and requires `document.view`. Apply the existing `document.*` permissions and never expose storage references across tenants.

The MVP supports internal recruiting records only. It intentionally excludes public application portals, job-board integrations, AI screening, configurable assessments, and onboarding automation.
