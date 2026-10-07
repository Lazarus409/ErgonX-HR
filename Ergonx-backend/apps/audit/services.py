from apps.audit.models import AuditLog
from apps.audit.context import get_audit_request_context


def record_audit_event(
    *,
    actor,
    action,
    institution=None,
    entity=None,
    metadata=None,
    ip=None,
    user_agent=None,
):
    request_context = get_audit_request_context()
    if ip is None:
        ip = request_context["ip"]
    if user_agent is None:
        user_agent = request_context["user_agent"]
    return AuditLog.objects.create(
        institution=institution,
        actor=actor,
        action=action,
        entity_type=entity._meta.label if entity else "",
        entity_id=getattr(entity, "pk", None),
        metadata=metadata or {},
        ip_address=ip,
        user_agent=user_agent,
    )


MASKED = "[changed]"


def snapshot(instance, fields):
    """Plain, JSON-safe values of ``fields`` for before/after comparison."""
    values = {}
    for name in fields:
        value = getattr(instance, f"{name}_id", None) if hasattr(instance, f"{name}_id") else getattr(instance, name, None)
        values[name] = None if value is None else str(value)
    return values


def field_changes(before, after, *, masked=()):
    """The standard ``metadata.changes`` shape (W0-AUD-04): ``{field: [old, new]}``.

    Fields in ``masked`` (personal identifiers and contact details) record only
    that they changed, never their values.
    """
    changes = {}
    for name in sorted(set(before) | set(after)):
        old, new = before.get(name), after.get(name)
        if old != new:
            changes[name] = [MASKED, MASKED] if name in masked else [old, new]
    return changes
