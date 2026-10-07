from rest_framework import serializers


class HomeSerializer(serializers.Serializer):
    greeting_context = serializers.DictField()
    quick_actions = serializers.ListField(child=serializers.DictField())
    recent_work = serializers.ListField(child=serializers.DictField())
    attention_items = serializers.ListField(child=serializers.DictField())
    notifications_summary = serializers.DictField()
    optional_personal_snapshot = serializers.JSONField(allow_null=True)
    team_snapshot = serializers.JSONField(allow_null=True)
