# Employee lifecycle frontend contract

Employee lifecycle actions are server-owned:

- `GET /api/v1/employees/{id}/lifecycle/`
- `POST /api/v1/employees/{id}/onboarding/start/`
- `POST /api/v1/employees/{id}/onboarding/complete/`
- `POST /api/v1/employees/{id}/offboarding/start/` (optional `last_working_day`, `reason`, `notes`)
- `POST /api/v1/employees/{id}/offboarding/complete/`

All require `employee.update`. Completion validates a current employment record and offboarding blockers. Offboarding ends the employee’s employment and deactivates only the selected institution membership; it never disables the global user account. The server can reject a completion that would remove the last active Institution Admin. Recruitment hires create a `NOT_STARTED` onboarding record automatically.
