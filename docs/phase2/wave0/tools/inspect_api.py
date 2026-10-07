"""Wave 0 read-only inspection: every /api/v1/ operation with its view, module and permission.

Run from Ergonx-backend/ (no database writes; the test settings are enough):

    DJANGO_SETTINGS_MODULE=config.settings.test python ../docs/phase2/wave0/tools/inspect_api.py > ops.json

For each URL pattern it resolves the view class, then for each HTTP method the
DRF action, ``required_module`` and the permission code that
``get_required_permission()`` returns for that action. Views that compute the
permission from request state are reported as ``"<dynamic: ...>"``.
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")

import django  # noqa: E402

django.setup()

from django.urls import URLPattern, URLResolver, get_resolver  # noqa: E402
from rest_framework.test import APIRequestFactory  # noqa: E402

factory = APIRequestFactory()


def walk(patterns, prefix=""):
    for p in patterns:
        if isinstance(p, URLResolver):
            yield from walk(p.url_patterns, prefix + str(p.pattern))
        elif isinstance(p, URLPattern):
            yield prefix + str(p.pattern), p


def clean(route):
    route = route.replace("^", "").replace("$", "").replace("\\Z", "")
    route = re.sub(r"\(\?P<(\w+)>[^)]*\)", r"{\1}", route)
    route = re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", route)
    route = route.replace("\\.(?P<format>[a-z0-9]+)/?", "")
    return "/" + route


def perm_for(cls, action, method, initkwargs):
    view = cls(**initkwargs)
    view.action = action
    view.kwargs = {}
    view.format_kwarg = None
    request = getattr(factory, method.lower())("/")
    view.request = request
    try:
        value = view.get_required_permission()
        return value
    except Exception as exc:  # computed from request/user state
        return f"<dynamic: {type(exc).__name__}>"


def module_for(cls, action, method, initkwargs):
    raw = getattr(cls, "required_module", None)
    if not isinstance(raw, property):
        return raw
    view = cls(**initkwargs)
    view.action = action
    view.kwargs = {}
    view.request = getattr(factory, method.lower())("/")
    try:
        return view.required_module
    except Exception as exc:
        return f"<dynamic: {type(exc).__name__}>"


def serializer_for(cls, action, initkwargs):
    view = cls(**initkwargs)
    view.action = action
    view.kwargs = {}
    view.format_kwarg = None
    view.request = factory.get("/")
    try:
        s = view.get_serializer_class()
        return s.__name__ if s else None
    except Exception:
        s = getattr(cls, "serializer_class", None)
        return s.__name__ if s else None


rows = []
for route, pattern in walk(get_resolver().url_patterns):
    if not route.startswith("api/v1/"):
        continue
    cb = pattern.callback
    cls = getattr(cb, "cls", None) or getattr(cb, "view_class", None)
    if cls is None:
        continue
    path = clean(route)
    if "format" in path:
        continue
    actions = getattr(cb, "actions", None)
    initkwargs = getattr(cb, "initkwargs", {}) or {}
    if actions:
        method_actions = actions.items()
    else:
        method_actions = [(m, m) for m in ("get", "post", "put", "patch", "delete") if hasattr(cls, m)]
    perm_classes = [c.__name__ for c in getattr(cls, "permission_classes", [])]
    allowed = {m.lower() for m in getattr(cls, "http_method_names", ())}
    for method, action in method_actions:
        if allowed and method.lower() not in allowed:
            continue  # routed by the DRF router but refused with 405 by the view
        if hasattr(cls, "get_required_permission"):
            perm = perm_for(cls, action, method, initkwargs)
        else:
            perm = None
        rows.append(
            {
                "path": path,
                "method": method.upper(),
                "action": action,
                "view": f"{cls.__module__}.{cls.__name__}",
                "required_module": module_for(cls, action, method, initkwargs),
                "required_permission": perm,
                "permission_classes": perm_classes,
                "serializer": serializer_for(cls, action, initkwargs) if hasattr(cls, "get_serializer_class") else None,
            }
        )

seen = set()
unique = []
for r in rows:
    key = (r["path"], r["method"])
    if key in seen:
        continue
    seen.add(key)
    unique.append(r)
json.dump(unique, sys.stdout, indent=1)
