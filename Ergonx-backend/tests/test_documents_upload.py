from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIRequestFactory

from apps.documents.serializers import DocumentSerializer, ImageAssetSerializer


def _serializer(uploaded_file):
    request = APIRequestFactory().post("/api/v1/documents/", {})
    return DocumentSerializer(data={"uploaded_file": uploaded_file}, context={"request": request})


def test_managed_document_upload_accepts_any_file_type():
    uploaded = SimpleUploadedFile("minutes.docx", b"PK\x03\x04word", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    serializer = _serializer(uploaded)

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["content_type"].endswith("wordprocessingml.document")


def test_managed_document_upload_rejects_files_over_the_size_limit(settings):
    settings.DOCUMENT_UPLOAD_MAX_BYTES = 4
    serializer = _serializer(SimpleUploadedFile("big.bin", b"12345", content_type="application/octet-stream"))

    assert not serializer.is_valid()
    assert "uploaded_file" in serializer.errors


def test_managed_document_upload_accepts_small_pdf_signature():
    uploaded = SimpleUploadedFile("evidence.pdf", b"%PDF-1.7\n", content_type="application/pdf")
    serializer = _serializer(uploaded)

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["size_bytes"] == len(b"%PDF-1.7\n")


def test_image_upload_rejects_mismatched_signature():
    uploaded = SimpleUploadedFile("avatar.png", b"not an image", content_type="image/png")
    serializer = ImageAssetSerializer(data={"owner_type": "USER", "owner_id": "00000000-0000-0000-0000-000000000001", "uploaded_file": uploaded})

    assert not serializer.is_valid()
    assert "uploaded_file" in serializer.errors


def test_image_upload_accepts_png_signature():
    uploaded = SimpleUploadedFile("avatar.png", b"\x89PNG\r\n\x1a\nminimal", content_type="image/png")
    serializer = ImageAssetSerializer(data={"owner_type": "USER", "owner_id": "00000000-0000-0000-0000-000000000001", "uploaded_file": uploaded})

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["content_type"] == "image/png"
