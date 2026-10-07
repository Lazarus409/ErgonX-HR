"""Governed bulk actions (concept "Bulk actions and batch governance").

A bulk action is only ever the record's own service run once per record. Preview dry-runs each
service inside a savepoint that is always rolled back, so eligibility comes from the real
business rules instead of a copy of them. Execute runs each record in its own savepoint and keeps
a BatchJob with per-record results.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounting.models import BatchJob, VendorBill
from apps.audit.services import record_audit_event

MAX_BATCH_ITEMS = 200


@dataclass(frozen=True)
class BatchOperation:
    code: str
    label: str
    description: str
    group: str  # safe | workflow | restricted
    permission: str
    run: Callable | None = None
    precheck: Callable | None = None  # returns a reason the record is skipped, or ""
    needs_reason: bool = False
    confirm_text: str = ""
    unavailable_reason: str = ""
    extra: dict = field(default_factory=dict)


class _DryRun(Exception):
    pass


def _message(exc):
    if hasattr(exc, "message_dict"):
        for messages in exc.message_dict.values():
            if messages:
                return str(messages[0])
    return str(exc.messages[0]) if getattr(exc, "messages", None) else str(exc)


def _vendor_bill_operations():
    from apps.accounting import services

    return {
        "hold": BatchOperation(
            "hold", "Place on hold", "Pause approval and payment until released", "safe", "vendor_bill.approve",
            run=lambda bill, actor, reason: services.set_vendor_bill_hold(bill=bill, actor=actor, on_hold=True, reason=reason),
            precheck=lambda bill: "Already on hold" if bill.on_hold else "",
            needs_reason=True,
        ),
        "release": BatchOperation(
            "release", "Release hold", "Return held bills to their normal workflow", "safe", "vendor_bill.approve",
            run=lambda bill, actor, reason: services.set_vendor_bill_hold(bill=bill, actor=actor, on_hold=False),
            precheck=lambda bill: "" if bill.on_hold else "Not on hold",
        ),
        "submit": BatchOperation(
            "submit", "Send for approval", "Submit selected draft bills to the approval workflow", "workflow", "vendor_bill.create",
            run=lambda bill, actor, reason: services.submit_vendor_bill(bill=bill, actor=actor),
            precheck=lambda bill: "Already pending approval" if bill.status == VendorBill.Status.PENDING else "",
        ),
        "approve": BatchOperation(
            "approve", "Approve", "Approve selected pending bills for posting", "workflow", "vendor_bill.approve",
            run=lambda bill, actor, reason: services.approve_vendor_bill(bill=bill, actor=actor),
            precheck=lambda bill: "Already approved" if bill.status == VendorBill.Status.APPROVED else "",
        ),
        "void": BatchOperation(
            "void", "Void", "Void selected bills (only if not yet posted or paid)", "restricted", "vendor_bill.void",
            run=lambda bill, actor, reason: services.void_vendor_bill(bill=bill, actor=actor),
            precheck=lambda bill: "Already void" if bill.status == VendorBill.Status.VOID else "",
            needs_reason=True, confirm_text="VOID",
        ),
        "delete": BatchOperation(
            "delete", "Delete", "Permanently delete bills", "restricted", "vendor_bill.void",
            unavailable_reason="Financial records are never deleted in ErgonX. Void unposted bills instead so the audit trail is kept.",
        ),
    }


RESOURCES = {
    "vendor_bill": {
        "model": VendorBill,
        "label": "bills",
        "operations": _vendor_bill_operations,
        "reference": lambda bill: bill.bill_number,
        "amount": lambda bill: bill.total_amount or Decimal("0"),
        "queryset": lambda institution: VendorBill.objects.for_institution(institution).select_related("vendor"),
    },
}


def _permission_codes(actor, institution):
    membership = actor.memberships.filter(institution=institution, status="ACTIVE").select_related("role").first()
    return set(membership.role.permissions.values_list("code", flat=True)) if membership else set()


def _records(config, institution, ids):
    if not ids:
        raise DjangoValidationError({"ids": "Select at least one record."})
    if len(ids) > MAX_BATCH_ITEMS:
        raise DjangoValidationError({"ids": f"Select at most {MAX_BATCH_ITEMS} records per batch."})
    records = list(config["queryset"](institution).filter(pk__in=ids))
    if len(records) != len(set(str(item) for item in ids)):
        raise DjangoValidationError({"ids": "Some selected records no longer exist or belong to another institution."})
    return records


def _check(operation, record, actor):
    """Return "" when the operation would succeed for this record, otherwise the reason it would not."""
    skipped = operation.precheck(record) if operation.precheck else ""
    if skipped:
        return skipped
    try:
        with transaction.atomic():
            operation.run(record, actor, "Bulk action preview")
            raise _DryRun
    except _DryRun:
        return ""
    except DjangoValidationError as exc:
        return _message(exc)


def preview(*, resource, institution, actor, ids):
    config = RESOURCES[resource]
    records = _records(config, institution, ids)
    codes = _permission_codes(actor, institution)
    currencies = sorted({getattr(record, "currency", "") for record in records} - {""})
    operations = []
    for operation in config["operations"]().values():
        entry = {
            "code": operation.code, "label": operation.label, "description": operation.description, "group": operation.group,
            "needs_reason": operation.needs_reason, "confirm_text": operation.confirm_text,
            "available": True, "unavailable_reason": "", "eligible": [], "ineligible": [], "eligible_amount": "0",
        }
        if operation.unavailable_reason:
            entry.update(available=False, unavailable_reason=operation.unavailable_reason)
        elif operation.permission not in codes:
            entry.update(available=False, unavailable_reason="Your role does not allow this action.")
        else:
            amount = Decimal("0")
            for record in records:
                reason = _check(operation, record, actor)
                if reason:
                    entry["ineligible"].append({"id": str(record.pk), "reference": config["reference"](record), "reason": reason})
                else:
                    entry["eligible"].append(str(record.pk))
                    amount += config["amount"](record)
            entry["eligible_amount"] = str(amount)
            if not entry["eligible"]:
                entry.update(available=False, unavailable_reason="None of the selected records can take this action.")
        operations.append(entry)
    return {
        "resource": resource,
        "count": len(records),
        "total_amount": str(sum((config["amount"](record) for record in records), Decimal("0"))),
        "currencies": currencies,
        "operations": operations,
    }


def execute(*, resource, institution, actor, ids, operation_code, reason="", confirm_text=""):
    config = RESOURCES[resource]
    operations = config["operations"]()
    operation = operations.get(operation_code)
    if operation is None:
        raise DjangoValidationError({"operation": "Unknown bulk action."})
    if operation.unavailable_reason:
        raise DjangoValidationError({"operation": operation.unavailable_reason})
    if operation.permission not in _permission_codes(actor, institution):
        raise DjangoValidationError({"operation": "Your role does not allow this action."})
    reason = (reason or "").strip()
    if operation.needs_reason and not reason:
        raise DjangoValidationError({"reason": "Give a reason for this bulk action."})
    if operation.confirm_text and (confirm_text or "").strip().upper() != operation.confirm_text:
        raise DjangoValidationError({"confirm_text": f"Type {operation.confirm_text} to confirm."})
    records = _records(config, institution, ids)
    job = BatchJob.objects.create(
        institution=institution, resource=resource, operation=operation_code, status=BatchJob.Status.PROCESSING,
        reason=reason, total_items=len(records), created_by=actor, started_at=timezone.now(),
        total_amount=sum((config["amount"](record) for record in records), Decimal("0")),
    )
    results = []
    for record in records:
        outcome = {"id": str(record.pk), "reference": config["reference"](record)}
        skipped = operation.precheck(record) if operation.precheck else ""
        if skipped:
            results.append({**outcome, "status": "failed", "message": skipped})
            continue
        try:
            with transaction.atomic():
                operation.run(record, actor, reason)
            results.append({**outcome, "status": "succeeded", "message": ""})
        except DjangoValidationError as exc:
            results.append({**outcome, "status": "failed", "message": _message(exc)})
    job.succeeded = sum(1 for item in results if item["status"] == "succeeded")
    job.failed = len(results) - job.succeeded
    job.results = results
    job.status = (
        BatchJob.Status.COMPLETED if job.failed == 0
        else BatchJob.Status.FAILED if job.succeeded == 0
        else BatchJob.Status.PARTIAL
    )
    job.completed_at = timezone.now()
    job.save(update_fields=("succeeded", "failed", "results", "status", "completed_at", "updated_at"))
    record_audit_event(
        actor=actor, institution=institution, entity=job, action="accounting.batch_job.completed",
        metadata={"resource": resource, "operation": operation_code, "succeeded": job.succeeded, "failed": job.failed, "reason": reason},
    )
    return job


def serialize_job(job, operations=None):
    operations = operations or {}
    label = operations[job.operation].label if job.operation in operations else job.operation.replace("_", " ").capitalize()
    return {
        "id": str(job.id), "resource": job.resource, "operation": job.operation, "operation_label": label,
        "status": job.status, "reason": job.reason, "total_items": job.total_items, "succeeded": job.succeeded,
        "failed": job.failed, "total_amount": str(job.total_amount), "results": job.results,
        "created_by": (job.created_by.get_full_name() or job.created_by.email) if job.created_by_id else None,
        "created_at": job.created_at, "started_at": job.started_at, "completed_at": job.completed_at,
    }
