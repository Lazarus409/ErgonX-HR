import pytest


@pytest.mark.django_db
def test_documents_api_is_tenant_scoped_and_assigns_current_uploader(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="DOCUMENTS-HOME")
    foreign = institution_factory(code="DOCUMENTS-FOREIGN")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    membership_factory(user=user, institution=foreign, role_code="HR_ADMIN")
    api_client.force_authenticate(user)
    payload = {"file_reference": "private://employee/record.pdf", "original_filename": "record.pdf", "content_type": "application/pdf", "size_bytes": 12, "category": "EMPLOYMENT"}
    response = api_client.post("/api/v1/documents/", payload, format="json")
    assert response.status_code == 201
    assert response.data["uploaded_by"] == str(user.id)
    assert str(response.data["institution"]) == str(institution.id)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(foreign.id))
    assert api_client.get("/api/v1/documents/").data["results"] == []
