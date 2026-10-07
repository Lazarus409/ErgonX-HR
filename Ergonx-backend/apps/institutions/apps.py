from django.apps import AppConfig


class InstitutionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.institutions"
    label = "institutions"

    def ready(self):
        from apps.institutions import signals  # noqa: F401
