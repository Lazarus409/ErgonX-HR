# Home frontend contract

Base path: `/api/v1/home/` (`GET`). Send the normal bearer token and `X-Institution-ID` when required.

Requires `home.view` and an active tenant membership. The response is a personalized, permission- and module-filtered workspace, not a persisted dashboard copy:

```json
{
  "greeting_context": {"greeting": "Good morning, Ada", "institution_timezone": "Africa/Accra"},
  "quick_actions": [{"code": "leave.request", "label": "Request leave", "route_hint": "/me/leave/request", "is_pinned": true}],
  "recent_work": [{"type": "leave.leaverequest", "id": "UUID", "title": "Request leave", "resume_action": "leave.request", "resume_route": "/leave/requests/UUID", "can_resume": true}],
  "attention_items": [],
  "notifications_summary": {"unread_count": 0, "latest": []},
  "optional_personal_snapshot": null
}
```

Render only returned action and route hints. `recent_work` contains at most two items. IDs are serialized as strings even when the underlying entity uses UUID storage. When a non-empty `resume_route` is supplied, use it instead of the broader quick-action `route_hint`: it points to the server-recorded work item. Current detail-route coverage includes employee, candidate, application, leave-request, attendance-adjustment, interview, offer, compensation change, payroll adjustment, journal creation/approval, and payroll-run preparation activity. The frontend may fall back to the authorized quick-action route only when no entity route is available. Attention is actionable work and must not be merged into notifications. Use the supplied local-time context; never infer the institution timezone from the browser.

`GET /api/v1/auth/bootstrap/` establishes the active institution, active membership, effective permissions, enabled modules, onboarding status, controlled `default_landing`, and eligible dashboard identifiers. Home is distinct from the executive and module dashboard endpoints.
