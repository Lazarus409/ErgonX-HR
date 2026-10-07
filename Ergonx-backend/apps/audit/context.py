from contextvars import ContextVar


_audit_request_context = ContextVar("audit_request_context", default=None)


def set_audit_request_context(*, ip=None, user_agent=""):
    return _audit_request_context.set(
        {"ip": ip or None, "user_agent": user_agent or ""}
    )


def reset_audit_request_context(token):
    _audit_request_context.reset(token)


def get_audit_request_context():
    return _audit_request_context.get() or {"ip": None, "user_agent": ""}
