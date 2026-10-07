"""Wave 0 read-only inspection: permission codes, role defaults and the endpoints that require them.

Run from Ergonx-backend/ after inspect_api.py has written the operation inventory:

    DJANGO_SETTINGS_MODULE=config.settings.test python ../docs/phase2/wave0/tools/inspect_api.py > ../docs/phase2/wave0/api_operation_inventory.json
    DJANGO_SETTINGS_MODULE=config.settings.test python ../docs/phase2/wave0/tools/build_permission_inventory.py

Writes ../docs/phase2/wave0/permission_inventory.json. Nothing in the database is read or written;
role defaults come from apps.institutions.services.ROLE_PERMISSION_CODES.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
import django  # noqa: E402

django.setup()

from apps.institutions.services import (  # noqa: E402
    PERMISSION_MODULES,
    PERMISSIONS,
    ROLE_PERMISSION_CODES,
    SELF_SERVICE_PERMISSIONS,
)
from common.permissions import READ_ONLY_ROLES, SELF_SERVICE_ACTIONS  # noqa: E402

OUT = Path("../docs/phase2/wave0")
ops = json.loads((OUT / "api_operation_inventory.json").read_text(encoding="utf-8"))

# Migrations seed classification; only audit.view is PRIVILEGED (0033). Everything else is NORMAL.
PRIVILEGED = {"audit.view"}

rows = []
for code, description in PERMISSIONS.items():
    endpoints = sorted({f"{op['method']} {op['path']}" for op in ops if op["required_permission"] == code})
    rows.append(
        {
            "code": code,
            "description": description,
            "module": PERMISSION_MODULES.get(code, "CORE_HR"),
            "classification": "PRIVILEGED" if code in PRIVILEGED else "NORMAL",
            "roles": [role for role, codes in ROLE_PERMISSION_CODES.items() if code in codes],
            "self_service_bundle": code in SELF_SERVICE_PERMISSIONS,
            "read_only_role_write_exempt": code in SELF_SERVICE_ACTIONS,
            "endpoint_count": len(endpoints),
            "endpoints": endpoints,
        }
    )

(OUT / "permission_inventory.json").write_text(
    json.dumps({"read_only_roles": sorted(READ_ONLY_ROLES), "permissions": rows}, indent=1), encoding="utf-8"
)
print(len(rows), "permissions;", sum(1 for r in rows if r["endpoint_count"] == 0), "with no direct endpoint")
