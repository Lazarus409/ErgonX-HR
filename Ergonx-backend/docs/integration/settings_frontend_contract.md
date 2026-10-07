# Settings frontend contract

Settings are layered and must not be represented as one unrestricted JSON editor.

| Layer | Route | Permission |
|---|---|---|
| Personal preferences | `GET/PUT /api/v1/institutions/preferences/` | `settings.profile.manage_self` |
| Institution settings | `GET /api/v1/institutions/settings/` | `settings.institution.view` |
| Institution setting update | `PUT /api/v1/institutions/settings/` | `settings.institution.manage` |
| Module configuration | `GET/PATCH /api/v1/institutions/modules/{id}/` | `settings.modules.manage` |
| Role catalogue/roles | `/api/v1/institutions/permissions/`, `/roles/` | `settings.roles.manage` |

Preference writes contain `preference_key` and `value_json`. Institution writes contain `key` and `value`; sensitive records are never returned by the general read route. The server controls permission assignment, module gating, and configuration status. Refresh bootstrap after changing modules or role membership.
