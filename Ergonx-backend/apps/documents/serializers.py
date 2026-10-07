import mimetypes

from django.conf import settings
from rest_framework import serializers

from apps.documents.models import Document, ImageAsset


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_file = serializers.FileField(write_only=True, required=False)
    uploaded_by = serializers.UUIDField(read_only=True, source="uploaded_by_id")

    class Meta:
        model = Document
        fields = (
            "id", "institution", "uploaded_by", "file_reference", "uploaded_file", "original_filename",
            "content_type", "size_bytes", "category", "classification", "checksum",
            "entity_type", "entity_id", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "institution", "uploaded_by", "created_at", "updated_at")
        extra_kwargs = {
            "original_filename": {"required": False},
            "content_type": {"required": False},
            "size_bytes": {"required": False},
        }

    def validate(self, attrs):
        uploaded_file = attrs.get("uploaded_file")
        if uploaded_file is None and not attrs.get("file_reference", "").strip():
            raise serializers.ValidationError({"file_reference": "Provide an approved storage reference or upload a file."})
        if uploaded_file is not None:
            # Any file type is accepted. Downloads are always sent as attachments
            # with nosniff, so a stored file is never rendered inline.
            max_bytes = settings.DOCUMENT_UPLOAD_MAX_BYTES
            if uploaded_file.size > max_bytes:
                raise serializers.ValidationError({"uploaded_file": f"Documents must be {max_bytes // (1024 * 1024)} MB or smaller."})
            name = (uploaded_file.name or "document").replace("\\", "/").rsplit("/", 1)[-1][:255] or "document"
            content_type = (uploaded_file.content_type or "").lower().split(";")[0].strip()
            if not content_type or content_type == "application/octet-stream":
                content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
            attrs["content_type"] = content_type[:150]
            attrs["size_bytes"] = uploaded_file.size
            attrs["original_filename"] = name
        return attrs

    def create(self, validated_data):
        uploaded_file = validated_data.pop("uploaded_file", None)
        if uploaded_file is not None:
            validated_data["stored_file"] = uploaded_file
        instance = super().create(validated_data)
        if uploaded_file is not None:
            instance.file_reference = f"managed:{instance.stored_file.name}"
            instance.save(update_fields=("file_reference", "updated_at"))
        return instance

    def validate_file_reference(self, value):
        if not value.strip():
            raise serializers.ValidationError("A storage reference is required.")
        return value


class ImageAssetSerializer(serializers.ModelSerializer):
    uploaded_file = serializers.FileField(write_only=True)

    class Meta:
        model = ImageAsset
        fields = ("id", "institution", "owner_type", "owner_id", "uploaded_file", "original_filename", "content_type", "size_bytes", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "institution", "original_filename", "content_type", "size_bytes", "created_at", "updated_at")

    ALLOWED = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n", "image/gif": b"GIF8"}
    MAX_BYTES = 5 * 1024 * 1024

    def validate(self, attrs):
        uploaded = attrs["uploaded_file"]
        content_type = (uploaded.content_type or "").lower()
        if content_type not in self.ALLOWED:
            raise serializers.ValidationError({"uploaded_file": "Only JPEG, PNG, or GIF images are supported."})
        if uploaded.size > self.MAX_BYTES:
            raise serializers.ValidationError({"uploaded_file": "Images must be 5 MB or smaller."})
        header = uploaded.read(12)
        uploaded.seek(0)
        if not header.startswith(self.ALLOWED[content_type]):
            raise serializers.ValidationError({"uploaded_file": "The image content does not match its declared type."})
        attrs["original_filename"] = uploaded.name[:255]
        attrs["content_type"] = content_type
        attrs["size_bytes"] = uploaded.size
        return attrs

    def create(self, validated_data):
        uploaded = validated_data.pop("uploaded_file")
        validated_data["stored_file"] = uploaded
        return super().create(validated_data)

