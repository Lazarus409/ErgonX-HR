from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers


def _as_api_validation_error(exc):
    detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
    api_exception = serializers.ValidationError(detail)
    api_exception.api_code = getattr(exc, "api_code", "validation_error")
    return api_exception


def call_validated_service(service, **values):
    try:
        return service(**values)
    except DjangoValidationError as exc:
        raise _as_api_validation_error(exc) from exc


class ValidatedModelSerializer(serializers.ModelSerializer):
    """Runs model validation so domain invariants also protect non-form API writes."""

    def create(self, validated_data):
        instance = self.Meta.model(**validated_data)
        self._validate_model(instance)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        for attribute, value in validated_data.items():
            setattr(instance, attribute, value)
        self._validate_model(instance)
        instance.save()
        return instance

    @staticmethod
    def _validate_model(instance):
        try:
            instance.full_clean()
        except DjangoValidationError as exc:
            raise _as_api_validation_error(exc) from exc
