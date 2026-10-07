"""HTTP response hardening that is safe for the API surface.

The API and its Swagger UI share a Django origin.  A blanket restrictive CSP
would break the documentation UI, so this middleware applies an API-data CSP
to JSON and schema responses while deliberately leaving `/api/v1/docs/` to
its own third-party asset policy.
"""


class ApiContentSecurityPolicyMiddleware:
    """Set a restrictive CSP on API responses without overwriting a view policy."""

    policy = "; ".join(
        (
            "default-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
            "sandbox",
        )
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/") and not request.path.startswith("/api/v1/docs/"):
            response.setdefault("Content-Security-Policy", self.policy)
        return response
