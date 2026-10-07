"""Wave 0 read-only inspection: every audit action emitted by backend code.

Run from Ergonx-backend/:  python ../docs/phase2/wave0/tools/inspect_audit.py
Scans record_audit_event(...) calls (and helpers that forward an ``action``)
and prints ``action<TAB>file:line<TAB>has_metadata``. f-string actions are
printed as their source text.
"""
import ast
import sys
from pathlib import Path

ROOTS = [Path("apps"), Path("common")]
CALLS = {"record_audit_event"}

for root in ROOTS:
    for path in sorted(root.rglob("*.py")):
        if "migrations" in path.parts or "tests" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name not in CALLS:
                continue
            action = next((k.value for k in node.keywords if k.arg == "action"), None)
            if action is None:
                continue
            if isinstance(action, ast.Constant):
                text = action.value
            else:
                text = "<expr> " + ast.get_source_segment(source, action)
            has_meta = any(k.arg == "metadata" for k in node.keywords)
            print(f"{text}\t{path.as_posix()}:{node.lineno}\t{'meta' if has_meta else ''}")
