"""Governed bulk actions on vendor bills (concept "Bulk actions and batch governance")."""
import pytest

from apps.accounting.models import BatchJob, VendorBill
from apps.accounting.services import approve_vendor_bill, post_vendor_bill, submit_vendor_bill
from apps.audit.models import AuditLog
from tests.test_accounts_payable_workspace import payables  # noqa: F401  (fixture)

pytestmark = pytest.mark.django_db


def _client(api_client, payables):
    api_client.force_authenticate(payables["actor"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(payables["institution"].id))
    return api_client


def _operation(preview, code):
    return next(item for item in preview["operations"] if item["code"] == code)


def test_preview_uses_real_rules_and_changes_nothing(api_client, payables):
    actor = payables["actor"]
    draft = payables["bill"]("BA-001")
    pending = submit_vendor_bill(bill=payables["bill"]("BA-002"), actor=actor)
    posted = post_vendor_bill(bill=approve_vendor_bill(bill=submit_vendor_bill(bill=payables["bill"]("BA-003"), actor=actor), actor=actor), actor=actor)
    client = _client(api_client, payables)
    audit_before = AuditLog.objects.count()

    response = client.post("/api/v1/vendor-bills/bulk/preview/", {"ids": [str(draft.id), str(pending.id), str(posted.id)]}, format="json")
    assert response.status_code == 200, response.content
    body = response.json()["data"]
    assert body["count"] == 3
    submit = _operation(body, "submit")
    assert submit["group"] == "workflow" and submit["eligible"] == [str(draft.id)]
    assert {item["reference"] for item in submit["ineligible"]} == {"BA-002", "BA-003"}
    void = _operation(body, "void")
    assert void["confirm_text"] == "VOID" and set(void["eligible"]) == {str(draft.id), str(pending.id)}
    assert void["ineligible"][0]["reference"] == "BA-003" and "Posted" in void["ineligible"][0]["reason"]
    delete = _operation(body, "delete")
    assert delete["available"] is False and "never deleted" in delete["unavailable_reason"]

    # The dry run rolled everything back.
    draft.refresh_from_db()
    pending.refresh_from_db()
    assert draft.status == VendorBill.Status.DRAFT and pending.status == VendorBill.Status.PENDING
    assert AuditLog.objects.count() == audit_before
    assert not BatchJob.objects.exists()


def test_execute_records_partial_success_per_bill(api_client, payables):
    actor = payables["actor"]
    first = payables["bill"]("BA-010")
    second = payables["bill"]("BA-011")
    already = submit_vendor_bill(bill=payables["bill"]("BA-012"), actor=actor)
    client = _client(api_client, payables)

    response = client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": [str(first.id), str(second.id), str(already.id)], "operation": "submit"}, format="json")
    assert response.status_code == 201, response.content
    job = response.json()["data"]
    assert job["status"] == "PARTIAL" and job["succeeded"] == 2 and job["failed"] == 1
    assert job["operation_label"] == "Send for approval"
    failed = next(item for item in job["results"] if item["status"] == "failed")
    assert failed["reference"] == "BA-012" and failed["message"] == "Already pending approval"
    first.refresh_from_db()
    assert first.status == VendorBill.Status.PENDING
    assert AuditLog.objects.filter(action="accounting.vendor_bill.submitted", entity_id=str(first.id)).exists()

    jobs = client.get("/api/v1/vendor-bills/batch-jobs/")
    assert jobs.status_code == 200 and jobs.json()["data"]["results"][0]["id"] == job["id"]


def test_execute_enforces_reason_confirmation_and_unavailable_actions(api_client, payables):
    bill = payables["bill"]("BA-020")
    client = _client(api_client, payables)
    ids = [str(bill.id)]

    assert client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": ids, "operation": "void", "reason": "Duplicate"}, format="json").status_code == 400
    assert client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": ids, "operation": "void", "confirm_text": "VOID"}, format="json").status_code == 400
    assert client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": ids, "operation": "delete"}, format="json").status_code == 400
    assert client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": [], "operation": "submit"}, format="json").status_code == 400

    done = client.post("/api/v1/vendor-bills/bulk/execute/", {"ids": ids, "operation": "void", "reason": "Duplicate", "confirm_text": "void"}, format="json")
    assert done.status_code == 201 and done.json()["data"]["status"] == "COMPLETED"
    bill.refresh_from_db()
    assert bill.status == VendorBill.Status.VOID


def test_bulk_actions_stay_inside_the_institution(api_client, payables, institution_factory):
    other = institution_factory(code="BA-OTHER", country_code="GH")
    bill = payables["bill"]("BA-030")
    client = _client(api_client, payables)
    client.credentials(HTTP_X_INSTITUTION_ID=str(other.id))
    response = client.post("/api/v1/vendor-bills/bulk/preview/", {"ids": [str(bill.id)]}, format="json")
    assert response.status_code in (400, 403, 404)
