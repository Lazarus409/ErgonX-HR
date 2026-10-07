"""Wave 0 read-only inspection: status/state choice fields on every ErgonX model.

Run from Ergonx-backend/:
    DJANGO_SETTINGS_MODULE=config.settings.test python ../docs/phase2/wave0/tools/inspect_states.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
import django  # noqa: E402

django.setup()
from django.apps import apps  # noqa: E402

for model in apps.get_models():
    if not model.__module__.startswith("apps."):
        continue
    for field in model._meta.get_fields():
        choices = getattr(field, "choices", None)
        if not choices or not any(k in field.name for k in ("status", "state", "stage", "decision", "action", "type", "kind")):
            continue
        values = ",".join(str(c[0]) for c in choices)
        print(f"{model._meta.app_label}.{model.__name__}.{field.name}: {values}")
