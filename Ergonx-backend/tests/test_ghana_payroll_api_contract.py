from datetime import date
from uuid import uuid4

import pytest
from django.urls import reverse

from apps.institutions.models import InstitutionModule
from apps.payroll.models import (
    EmployeePayrollProfile,
    InstitutionPayrollConfiguration,
    PayrollPeriod,
    PayrollPresetVersion,
)
from apps.payroll.services import (
    configure_employee_payroll_profile,
    configure_payroll,
)


pytestmark = pytest.mark.django_db


def _enable_payroll(institution):
    module = institution.modules.get(module_code=InstitutionModule.ModuleCode.PAYROLL)
    module.is_enabled = True
    module.save(update_fields=("is_enabled", "updated_at"))


def _ghana_version():
    return PayrollPresetVersion.objects.select_related("payroll_preset").get(
        payroll_preset__code="GH-PAYROLL", version_code="GH-2026.1"
    )


def _configure_ghana(institution, actor):
    return configure_payroll(
        institution=institution,
        actor=actor,
        country_code="GH",
        currency="GHS",
        payroll_frequency="MONTHLY",
        payroll_setup_mode="PRESET",
        selected_payroll_preset_version=_ghana_version(),
    )


def _assert_error(response, status, code):
    payload = response.json()
    assert response.status_code == status
    assert payload["success"] is False
    assert payload["data"] is None
    assert payload["code"] == code
    assert payload["message"]
    assert payload["errors"]


def _contract_operations(object_id=None):
    object_id = object_id or uuid4()
    return (
        ("get", reverse("v1:payroll-configuration-choices"), None),
        ("get", reverse("v1:payroll-configuration-list"), None),
        ("post", reverse("v1:payroll-configuration-list"), {}),
        (
            "patch",
            reverse("v1:payroll-configuration-detail", args=(object_id,)),
            {},
        ),
        ("get", reverse("v1:employee-payroll-profile-list"), None),
        ("post", reverse("v1:employee-payroll-profile-list"), {}),
        (
            "patch",
            reverse("v1:employee-payroll-profile-detail", args=(object_id,)),
            {},
        ),
        (
            "get",
            reverse("v1:payroll-period-compliance-deadlines", args=(object_id,)),
            None,
        ),
    )


def _request(api_client, method, url, data):
    return getattr(api_client, method)(url, data=data, format="json")


def test_ghana_contract_endpoints_require_authentication(api_client):
    for method, url, data in _contract_operations():
        _assert_error(
            _request(api_client, method, url, data), 401, "authentication_required"
        )


def test_ghana_contract_endpoints_require_enabled_payroll_module(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    hr = user_factory()
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    api_client.force_authenticate(hr)

    for method, url, data in _contract_operations():
        _assert_error(_request(api_client, method, url, data), 403, "module_disabled")


def test_ghana_contract_endpoints_enforce_operation_permissions(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    employee_user = user_factory()
    membership_factory(
        user=employee_user,
        institution=institution,
        role_code="EMPLOYEE",
        is_primary=True,
    )
    api_client.force_authenticate(employee_user)

    for method, url, data in _contract_operations():
        _assert_error(_request(api_client, method, url, data), 403, "permission_denied")


def test_ghana_contract_endpoints_hide_cross_tenant_records_and_relations(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    home = institution_factory(code="GH-HOME", country_code="GH", default_currency="GHS")
    foreign = institution_factory(
        code="GH-FOREIGN", country_code="GH", default_currency="GHS"
    )
    _enable_payroll(home)
    _enable_payroll(foreign)
    home_hr = user_factory()
    foreign_hr = user_factory()
    membership_factory(
        user=home_hr, institution=home, role_code="HR_ADMIN", is_primary=True
    )
    membership_factory(
        user=foreign_hr, institution=foreign, role_code="HR_ADMIN", is_primary=True
    )
    foreign_configuration = _configure_ghana(foreign, foreign_hr)
    foreign_employee = employee_factory(foreign)
    foreign_profile = configure_employee_payroll_profile(
        institution=foreign,
        actor=foreign_hr,
        employee=foreign_employee,
        tax_residency="RESIDENT",
    )
    foreign_period = PayrollPeriod.objects.create(
        institution=foreign,
        name="Foreign September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    api_client.force_authenticate(home_hr)

    hidden_urls = (
        reverse("v1:payroll-configuration-detail", args=(foreign_configuration.id,)),
        reverse("v1:employee-payroll-profile-detail", args=(foreign_profile.id,)),
        reverse(
            "v1:payroll-period-compliance-deadlines", args=(foreign_period.id,)
        ),
    )
    for url in hidden_urls:
        _assert_error(api_client.get(url), 404, "not_found")

    scoped_listing = api_client.get(
        reverse("v1:employee-payroll-profile-list")
    ).json()
    assert scoped_listing["data"]["count"] == 0

    rejected_relation = api_client.post(
        reverse("v1:employee-payroll-profile-list"),
        {"employee": str(foreign_employee.id), "tax_residency": "RESIDENT"},
        format="json",
    )
    _assert_error(rejected_relation, 400, "validation_error")
    assert not EmployeePayrollProfile.objects.filter(institution=home).exists()


def test_ghana_contract_success_envelopes_filters_pagination_and_deadlines(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    hr = user_factory()
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    _configure_ghana(institution, hr)
    employees = [employee_factory(institution) for _ in range(3)]
    profiles = [
        configure_employee_payroll_profile(
            institution=institution,
            actor=hr,
            employee=employee,
            tax_residency=residency,
            tax_identification_number=f"GHA-FILTER-{index}",
        )
        for index, (employee, residency) in enumerate(
            zip(employees, ("RESIDENT", "RESIDENT", "NON_RESIDENT")), start=1
        )
    ]
    period = PayrollPeriod.objects.create(
        institution=institution,
        name="September 2026",
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
        pay_date=date(2026, 9, 30),
    )
    api_client.force_authenticate(hr)

    choices = api_client.get(reverse("v1:payroll-configuration-choices")).json()
    assert set(choices) == {"success", "data", "message", "errors"}
    assert choices["success"] is True
    assert choices["data"]["country_code"] == "GH"
    assert choices["data"]["currency"] == "GHS"
    assert [choice["mode"] for choice in choices["data"]["choices"]] == [
        "PRESET",
        "CUSTOM",
    ]
    assert choices["data"]["choices"][0]["version_code"] == "GH-2026.1"

    listing = api_client.get(
        reverse("v1:employee-payroll-profile-list"),
        {"tax_residency": "RESIDENT", "page_size": 1},
    ).json()
    assert set(listing) == {"success", "data", "message", "errors"}
    assert listing["data"]["count"] == 2
    assert len(listing["data"]["results"]) == 1
    assert listing["data"]["results"][0]["tax_residency"] == "RESIDENT"
    assert listing["data"]["next"]

    employee_filter = api_client.get(
        reverse("v1:employee-payroll-profile-list"),
        {"employee": str(profiles[2].employee_id)},
    ).json()
    assert employee_filter["data"]["count"] == 1
    assert employee_filter["data"]["results"][0]["id"] == str(profiles[2].id)

    search = api_client.get(
        reverse("v1:employee-payroll-profile-list"), {"search": "GHA-FILTER-2"}
    ).json()
    assert search["data"]["count"] == 1
    assert search["data"]["results"][0]["id"] == str(profiles[1].id)

    deadlines = api_client.get(
        reverse("v1:payroll-period-compliance-deadlines", args=(period.id,))
    ).json()
    assert set(deadlines) == {"success", "data", "message", "errors"}
    assert isinstance(deadlines["data"], list)
    assert {item["code"]: item["due_date"] for item in deadlines["data"]} == {
        "PENSION_MONTHLY_REMITTANCE": "2026-10-14",
        "GRA_PAYE_MONTHLY_RETURN": "2026-10-15",
    }


def test_ghana_configuration_rejects_unsupported_or_mismatched_preset_values(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    hr = user_factory()
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    version = _ghana_version()
    api_client.force_authenticate(hr)
    url = reverse("v1:payroll-configuration-list")
    base = {
        "country_code": "GH",
        "currency": "GHS",
        "payroll_frequency": "MONTHLY",
        "payroll_setup_mode": "PRESET",
        "selected_payroll_preset_version": str(version.id),
        "pay_day_rule": {},
        "rounding_rule": {"method": "HALF_UP", "decimal_places": 2},
        "is_configured": True,
    }

    invalid_cases = (
        ({"currency": "USD"}, "currency"),
        ({"payroll_frequency": "WEEKLY"}, "payroll_frequency"),
        ({"country_code": "US"}, "selected_payroll_preset_version"),
        (
            {"rounding_rule": {"method": "HALF_EVEN", "decimal_places": 2}},
            "rounding_rule",
        ),
    )
    for changes, error_field in invalid_cases:
        response = api_client.post(url, {**base, **changes}, format="json")
        _assert_error(response, 400, "validation_error")
        assert error_field in response.json()["errors"]

    assert not InstitutionPayrollConfiguration.objects.filter(
        institution=institution
    ).exists()

    created = api_client.post(url, base, format="json")
    assert created.status_code == 201
    assert created.json()["success"] is True
    configuration = InstitutionPayrollConfiguration.objects.get(institution=institution)
    rejected_patch = api_client.patch(
        reverse("v1:payroll-configuration-detail", args=(configuration.id,)),
        {"currency": "USD"},
        format="json",
    )
    _assert_error(rejected_patch, 400, "validation_error")
    assert "currency" in rejected_patch.json()["errors"]
    configuration.refresh_from_db()
    assert configuration.currency == "GHS"


def test_ghana_profile_validation_contract_preserves_field_errors(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory(country_code="GH", default_currency="GHS")
    _enable_payroll(institution)
    hr = user_factory()
    membership_factory(
        user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True
    )
    employee = employee_factory(institution)
    api_client.force_authenticate(hr)
    url = reverse("v1:employee-payroll-profile-list")

    missing_residency = api_client.post(
        url, {"employee": str(employee.id)}, format="json"
    )
    _assert_error(missing_residency, 400, "validation_error")
    assert "tax_residency" in missing_residency.json()["errors"]

    invalid_residency = api_client.post(
        url,
        {"employee": str(employee.id), "tax_residency": "UNKNOWN"},
        format="json",
    )
    _assert_error(invalid_residency, 400, "validation_error")
    assert "tax_residency" in invalid_residency.json()["errors"]
