"""Global search: groups, snippets, filters, recent and saved searches (concept "Global search results")."""
import pytest

from apps.institutions.models import InstitutionModule

pytestmark = pytest.mark.django_db


def test_full_search_groups_recent_and_saved(api_client, institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory, employee_factory):
    institution = institution_factory(code="SEARCH-WS")
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)
    admin = user_factory(email="search.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    employee_factory(institution=institution, employee_number="EMP-JORDAN", first_name="Jordan", last_name="Taylor")
    api_client.force_authenticate(admin)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    response = api_client.get("/api/v1/search/", {"q": "jordan", "full": "1", "sort": "relevance"})
    assert response.status_code == 200, response.content
    data = response.data
    person = next(row for row in data["results"] if row["type"] == "EMPLOYEE")
    assert person["group"] == "PEOPLE" and person["snippet"] and person["meta"][0] == "Employee ID: EMP-JORDAN"
    assert data["groups"]["PEOPLE"] >= 1

    entries = api_client.get("/api/v1/search/entries/").data
    assert [row["query"] for row in entries["recent"]] == ["jordan"]
    saved = api_client.post("/api/v1/search/entries/", {"query": "jordan", "name": "Jordan records", "filters": {"module": "CORE_HR"}}, format="json")
    assert saved.status_code == 201 and saved.data["saved"][0]["name"] == "Jordan records"
    cleared = api_client.delete("/api/v1/search/entries/?kind=RECENT").data
    assert cleared["recent"] == [] and len(cleared["saved"]) == 1

    none_recent = api_client.get("/api/v1/search/", {"q": "jordan", "since": "7d", "department": "00000000-0000-0000-0000-000000000000", "full": "1"}).data
    assert all(row["type"] != "EMPLOYEE" for row in none_recent["results"])
