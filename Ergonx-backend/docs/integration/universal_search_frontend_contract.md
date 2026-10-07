# Universal search frontend contract

Use `GET /api/v1/search/?q=<text>&types=<CSV>&module=<module>&limit=<1-50>`. `q` requires at least two characters; malformed queries return `search_query_invalid`. The endpoint requires `search.use`, active tenant context, an enabled module, and the provider-specific view permission.

Each result is normalized as:

```json
{"type":"EMPLOYEE","module":"CORE_HR","id":"uuid","reference":"EMP-0001","title":"Ada Adams","subtitle":"ada@example.com","status":"ACTIVE","updated_at":"...","route_hint":"/hr/employees/uuid"}
```

Treat results as tenant-local and server-authorized. Do not render a client-side type as available merely because it appears in a saved filter. The backend uses PostgreSQL exact-code and case-insensitive field matching; there is no Elasticsearch dependency or cross-tenant fallback.
