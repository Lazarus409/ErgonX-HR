from rest_framework import serializers

from apps.operations.models import BackgroundJob, ExportJob, ImportJob, ImportRowResult
from apps.reports.services import normalize_report_type


class BackgroundJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackgroundJob
        fields = ("id", "institution", "job_type", "initiated_by", "status", "progress", "result_reference", "error_summary", "started_at", "completed_at", "metadata", "created_at", "updated_at")
        read_only_fields = fields


class ImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportJob
        fields = ("id", "institution", "import_type", "file_reference", "initiated_by", "status", "total_rows", "valid_rows", "invalid_rows", "error_summary", "confirmed_at", "completed_at", "metadata", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "initiated_by", "status", "total_rows", "valid_rows", "invalid_rows", "error_summary", "confirmed_at", "completed_at", "created_at", "updated_at")


class ImportRowResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportRowResult
        fields = ("id", "import_job", "row_number", "status", "raw_data", "normalized_data", "errors", "warnings", "created_at", "updated_at")
        read_only_fields = fields


class ExportJobSerializer(serializers.ModelSerializer):
    def validate_export_type(self, value):
        normalize_report_type(value)
        return value

    class Meta:
        model = ExportJob
        fields = ("id", "institution", "export_type", "initiated_by", "status", "result_reference", "error_summary", "completed_at", "metadata", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "initiated_by", "status", "result_reference", "error_summary", "completed_at", "created_at", "updated_at")
