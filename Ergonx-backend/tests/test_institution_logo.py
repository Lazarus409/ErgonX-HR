import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.documents.models import ImageAsset

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture
def institution_logo(settings, tmp_path, institution_factory):
    settings.MEDIA_ROOT = tmp_path

    def create(institution):
        return ImageAsset.objects.create(
            institution=institution,
            owner_type=ImageAsset.OwnerType.INSTITUTION,
            owner_id=institution.id,
            stored_file=SimpleUploadedFile("logo.png", PNG_BYTES, content_type="image/png"),
            original_filename="logo.png",
            content_type="image/png",
            size_bytes=len(PNG_BYTES),
        )

    return create


@pytest.mark.django_db
def test_bootstrap_exposes_active_institution_logo(api_client, institution_factory, user_factory, membership_factory, institution_logo):
    institution = institution_factory(code="LOGO-HOME")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    api_client.force_authenticate(user)

    assert api_client.get("/api/v1/auth/bootstrap/").data["active_institution"]["logo_image_id"] is None

    logo = institution_logo(institution)
    assert api_client.get("/api/v1/auth/bootstrap/").data["active_institution"]["logo_image_id"] == str(logo.id)


@pytest.mark.django_db
def test_members_can_view_but_not_manage_institution_logo(api_client, institution_factory, user_factory, membership_factory, institution_logo):
    institution = institution_factory(code="LOGO-VIEW")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    logo = institution_logo(institution)
    api_client.force_authenticate(user)

    content = api_client.get(f"/api/v1/images/{logo.id}/content/")
    assert content.status_code == 200
    assert content["Content-Type"] == "image/png"

    assert api_client.delete(f"/api/v1/images/{logo.id}/").status_code == 403
    logo.refresh_from_db()
    assert logo.is_active


@pytest.mark.django_db
def test_institution_logo_is_not_visible_to_other_institutions(api_client, institution_factory, user_factory, membership_factory, institution_logo):
    home = institution_factory(code="LOGO-OWN")
    foreign = institution_factory(code="LOGO-OTHER")
    user = user_factory()
    membership_factory(user=user, institution=home, role_code="EMPLOYEE", is_primary=True)
    foreign_logo = institution_logo(foreign)
    api_client.force_authenticate(user)

    assert api_client.get(f"/api/v1/images/{foreign_logo.id}/content/").status_code in (403, 404)
