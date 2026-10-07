from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.http import require_GET
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


@require_GET
def health(request):
    """Liveness probe for the hosting platform.

    Deliberately touches neither the database nor the schema generator: it is
    polled every few seconds, and a database query would keep a scale-to-zero
    database awake while building the OpenAPI schema is too slow on small instances.
    """
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/health/", health, name="health"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/v1/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/v1/", include(("config.v1_urls", "api-v1"), namespace="v1")),
]
