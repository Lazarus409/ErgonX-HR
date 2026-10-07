# Emergency contacts ? frontend contract

Emergency contacts are tenant-scoped Core HR records. Every request requires
the normal bearer token and `X-Institution-ID` header, and uses the active
membership's employee permissions.

## Endpoints

- `GET /api/v1/emergency-contacts/?employee=<employee-uuid>`
- `POST /api/v1/emergency-contacts/`
- `GET /api/v1/emergency-contacts/{id}/`
- `PATCH /api/v1/emergency-contacts/{id}/`
- `DELETE /api/v1/emergency-contacts/{id}/`

## Request fields

`employee`, `full_name`, `relationship`, and `phone` are required for creates.
`alternate_phone`, `email`, `address`, and `is_primary` are optional.

The backend enforces tenant ownership of the employee and permits only one
primary contact per employee. Saving a contact with `is_primary: true`
automatically demotes the prior primary contact in the same transaction.
