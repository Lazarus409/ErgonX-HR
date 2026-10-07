from rest_framework import serializers

from apps.audit.models import AuditLog


SENSITIVE_METADATA_KEYS = {"password", "token", "secret", "authorization", "access_token", "refresh_token"}


def safe_metadata(value):
    if isinstance(value, dict):
        return {key: "[redacted]" if key.lower() in SENSITIVE_METADATA_KEYS else safe_metadata(item) for key, item in value.items()}
    if isinstance(value, list):
        return [safe_metadata(item) for item in value]
    return value


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, allow_null=True)
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ("id", "created_at", "action", "entity_type", "entity_id", "actor_email", "ip_address", "user_agent", "metadata")
        read_only_fields = fields

    def get_metadata(self, instance) -> dict:
        return safe_metadata(instance.metadata)
