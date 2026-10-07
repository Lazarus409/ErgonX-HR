import hashlib
import json
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max, Sum
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.notifications.models import Notification
from apps.institutions.models import Institution
from apps.institutions.services import record_user_activity
from apps.payroll.calculation import calculate_employee_record, money
from apps.payroll.custom_rules import normalize_custom_rules, normalize_pay_day_rule
from apps.payroll.models import (
    PayrollRecord,
    PayrollRunException,
    EmployeeTaxReliefClaim,
    EmployeePayrollProfile,
    InstitutionPayrollConfiguration,
    PayrollAdjustment,
    PayrollPeriod,
    PayrollPresetVersion,
    PayrollRun,
    Payslip,
)
from apps.payroll.selectors import (
    active_payroll_preset_versions_for_institution,
    effective_compliance_deadlines_for_period,
    eligible_employees_for_payroll_run,
    payroll_records_with_items,
)
from common.exceptions import CodedValidationError


def _membership_with_permission(actor, institution, permission_code):
    membership = (
        actor.memberships.filter(institution=institution, status="ACTIVE")
        .select_related("role")
        .first()
    )
    if membership is None:
        raise CodedValidationError(
            {"actor": "Actor must be an active institution member."},
            api_code="permission_denied",
        )
    if not membership.role.permissions.filter(code=permission_code).exists():
        raise CodedValidationError(
            {"actor": f"Actor lacks {permission_code}."},
            api_code="permission_denied",
        )
    return membership


def _notify(user, institution, notification_type, title, message, metadata=None):
    if user is None:
        return
    Notification.objects.create(
        institution=institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata=metadata or {},
    )


def _notify_permission_holders(
    institution,
    permission_code,
    title,
    message,
    metadata=None,
    notification_type="PAYROLL_ACTION_REQUIRED",
):
    memberships = (
        institution.memberships.filter(
            status="ACTIVE", role__permissions__code=permission_code
        )
        .select_related("user")
        .distinct()
    )
    for membership in memberships:
        _notify(
            membership.user,
            institution,
            notification_type,
            title,
            message,
            metadata,
        )


def _status_change_metadata(before, after, **details):
    return {
        "before": {"status": before},
        "after": {"status": after},
        **details,
    }


@transaction.atomic
def configure_payroll(
    *,
    institution,
    actor,
    country_code,
    currency,
    payroll_frequency,
    payroll_setup_mode,
    selected_payroll_preset_version=None,
    pay_day_rule=None,
    rounding_rule=None,
    custom_rules=None,
    is_configured=True,
):
    _membership_with_permission(actor, institution, "payroll.configure")
    country_code = country_code.strip().upper()
    currency = currency.strip().upper()
    rounding_rule = rounding_rule or {"method": "HALF_UP", "decimal_places": 2}
    try:
        supported_rounding = (
            rounding_rule.get("method") == "HALF_UP"
            and int(rounding_rule.get("decimal_places")) == 2
        )
    except (TypeError, ValueError):
        supported_rounding = False
    if not supported_rounding:
        raise ValidationError(
            {"rounding_rule": "MVP supports HALF_UP rounding to two decimal places."}
        )
    rounding_rule = {"method": "HALF_UP", "decimal_places": 2}
    if selected_payroll_preset_version and (
        selected_payroll_preset_version.status != PayrollPresetVersion.Status.ACTIVE
    ):
        raise ValidationError(
            {"selected_payroll_preset_version": "Selected preset version must be active."}
        )
    if selected_payroll_preset_version:
        preset_metadata = selected_payroll_preset_version.source_metadata
        preset_currency = preset_metadata.get("currency")
        preset_frequency = preset_metadata.get("payroll_frequency")
        preset_errors = {}
        if preset_currency and currency != str(preset_currency).strip().upper():
            preset_errors["currency"] = (
                f"Selected preset version requires currency {preset_currency}."
            )
        if preset_frequency and payroll_frequency != preset_frequency:
            preset_errors["payroll_frequency"] = (
                f"Selected preset version requires payroll frequency {preset_frequency}."
            )
        if preset_errors:
            raise ValidationError(preset_errors)

    configuration = (
        InstitutionPayrollConfiguration.objects.select_for_update()
        .filter(institution=institution)
        .first()
    )
    if configuration is None:
        configuration = InstitutionPayrollConfiguration(institution=institution)
    configuration.country_code = country_code
    configuration.currency = currency
    configuration.payroll_frequency = payroll_frequency
    configuration.payroll_setup_mode = payroll_setup_mode
    configuration.selected_payroll_preset_version = selected_payroll_preset_version
    configuration.pay_day_rule = normalize_pay_day_rule(pay_day_rule)
    configuration.rounding_rule = rounding_rule
    configuration.custom_rules = (
        normalize_custom_rules(custom_rules)
        if payroll_setup_mode == InstitutionPayrollConfiguration.SetupMode.CUSTOM
        else {}
    )
    configuration.is_configured = is_configured
    configuration.configured_by = actor
    configuration.configured_at = timezone.now()
    configuration.full_clean()
    configuration.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=configuration,
        action="payroll.configuration.changed",
        metadata={"setup_mode": configuration.payroll_setup_mode},
    )
    return configuration


def payroll_setup_choices(institution):
    versions = active_payroll_preset_versions_for_institution(
        institution=institution
    )
    return {
        "country_code": institution.country_code,
        "currency": institution.default_currency,
        "choices": [
            {
                "mode": InstitutionPayrollConfiguration.SetupMode.PRESET,
                "preset_version_id": version.id,
                "preset_code": version.payroll_preset.code,
                "version_code": version.version_code,
                "name": version.payroll_preset.name,
                "recommended": bool(
                    version.source_metadata.get("recommended_for_country", False)
                ),
                "compliance_warning": None,
            }
            for version in versions
        ]
        + [
            {
                "mode": InstitutionPayrollConfiguration.SetupMode.CUSTOM,
                "preset_version_id": None,
                "preset_code": None,
                "version_code": None,
                "name": "Custom payroll configuration",
                "recommended": False,
                "compliance_warning": (
                    "No country statutory rules will be applied automatically. "
                    "The institution is responsible for configuring and validating "
                    "all applicable payroll obligations."
                ),
            }
        ],
    }


@transaction.atomic
def configure_employee_payroll_profile(
    *, institution, employee, actor, tax_residency, tax_identification_number=""
):
    _membership_with_permission(actor, institution, "payroll.configure")
    if employee.institution_id != institution.id:
        raise CodedValidationError(
            {"employee": "Employee belongs to another institution."},
            api_code="tenant_mismatch",
        )
    profile, _ = EmployeePayrollProfile.objects.select_for_update().update_or_create(
        employee=employee,
        defaults={
            "institution": institution,
            "tax_residency": tax_residency,
            "tax_identification_number": tax_identification_number,
        },
    )
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=profile,
        action="payroll.employee_profile.changed",
        metadata={"tax_residency": profile.tax_residency},
    )
    return profile


@transaction.atomic
def create_payroll_period(*, institution, actor, **values):
    _membership_with_permission(actor, institution, "payroll.prepare")
    configuration = getattr(institution, "payroll_configuration", None)
    if configuration is None or not configuration.is_configured:
        raise ValidationError({"institution": "Payroll must be configured first."})
    if (
        configuration.selected_payroll_preset_version_id
        and configuration.selected_payroll_preset_version.status
        != PayrollPresetVersion.Status.ACTIVE
    ):
        raise ValidationError(
            {"institution": "The configured payroll preset version is no longer active."}
        )
    period = PayrollPeriod(institution=institution, status=PayrollPeriod.Status.OPEN, **values)
    period.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=period,
        action="payroll.period.created",
    )
    return period


@transaction.atomic
def create_payroll_run(*, institution, payroll_period, actor, idempotency_key):
    _membership_with_permission(actor, institution, "payroll.prepare")
    if not idempotency_key or not idempotency_key.strip():
        raise ValidationError({"idempotency_key": "An idempotency key is required."})
    idempotency_key = idempotency_key.strip()
    institution = Institution.objects.select_for_update().get(pk=institution.pk)
    existing = PayrollRun.objects.filter(
        institution=institution, idempotency_key=idempotency_key
    ).first()
    if existing:
        if existing.payroll_period_id != payroll_period.id:
            raise CodedValidationError(
                {"idempotency_key": "This key belongs to another payroll period."},
                api_code="duplicate_operation",
            )
        return existing
    period = PayrollPeriod.objects.select_for_update().get(pk=payroll_period.pk)
    if period.institution_id != institution.id:
        raise CodedValidationError(
            {"payroll_period": "Payroll period belongs to another institution."},
            api_code="tenant_mismatch",
        )
    if period.status == PayrollPeriod.Status.CLOSED:
        raise CodedValidationError(
            {"payroll_period": "Closed periods cannot accept new runs."},
            api_code="period_closed",
        )
    if period.status != PayrollPeriod.Status.OPEN:
        raise CodedValidationError(
            {"payroll_period": "Only open periods accept new runs."},
            api_code="invalid_state_transition",
        )
    if period.runs.exclude(status=PayrollRun.Status.CANCELLED).exists():
        raise CodedValidationError(
            {"payroll_period": "This period already has an active payroll run."},
            api_code="duplicate_operation",
        )
    configuration = getattr(institution, "payroll_configuration", None)
    if configuration is None or not configuration.is_configured:
        raise ValidationError({"institution": "Payroll must be configured first."})
    next_number = (period.runs.aggregate(value=Max("run_number"))["value"] or 0) + 1
    run = PayrollRun(
        institution=institution,
        payroll_period=period,
        preset_version=configuration.selected_payroll_preset_version,
        run_number=next_number,
        status=PayrollRun.Status.DRAFT,
        started_by=actor,
        started_at=timezone.now(),
        idempotency_key=idempotency_key,
    )
    run.statutory_snapshot = _preset_snapshot(run, configuration)
    run.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=run,
        action="payroll.run.created",
        metadata={"run_number": next_number, "idempotency_key": idempotency_key},
    )
    # Keep Home's resumable activity feed separate from the audit log. This
    # runs inside the same transaction as the authoritative write.
    record_user_activity(
        actor=actor,
        institution=institution,
        activity_code="payroll.prepare",
        entity=run,
    )
    return run


def _configuration_snapshot(configuration):
    snapshot = {
        "country_code": configuration.country_code,
        "currency": configuration.currency,
        "payroll_frequency": configuration.payroll_frequency,
        "payroll_setup_mode": configuration.payroll_setup_mode,
        "selected_payroll_preset_version_id": (
            str(configuration.selected_payroll_preset_version_id)
            if configuration.selected_payroll_preset_version_id
            else None
        ),
        "pay_day_rule": configuration.pay_day_rule,
        "rounding_rule": configuration.rounding_rule,
    }
    # Only present when set, so runs snapshotted before custom rules existed still match.
    if configuration.custom_rules:
        snapshot["custom_rules"] = configuration.custom_rules
    return snapshot


def _preset_snapshot(run, configuration):
    configuration_snapshot = _configuration_snapshot(configuration)
    version = run.preset_version
    if version is None:
        return {
            "setup_mode": "CUSTOM",
            "preset_version": None,
            "configuration": configuration_snapshot,
        }
    return {
        "setup_mode": "PRESET",
        "configuration": configuration_snapshot,
        "preset": {
            "id": str(version.payroll_preset_id),
            "code": version.payroll_preset.code,
            "country_code": version.payroll_preset.country_code,
        },
        "version": {
            "id": str(version.id),
            "version_code": version.version_code,
            "effective_from": version.effective_from.isoformat(),
            "effective_to": version.effective_to.isoformat() if version.effective_to else None,
            "source_metadata": version.source_metadata,
        },
        "tax_rules": [
            {
                "id": str(rule.id),
                "code": rule.code,
                "method": rule.method,
                "residency": rule.residency,
                "rate": str(rule.rate) if rule.rate is not None else None,
                "threshold": str(rule.threshold) if rule.threshold is not None else None,
                "basis": rule.basis,
                "bands": [
                    {
                        "sequence": band.sequence,
                        "lower_bound": (
                            str(band.lower_bound) if band.lower_bound is not None else None
                        ),
                        "upper_bound": (
                            str(band.upper_bound) if band.upper_bound is not None else None
                        ),
                        "band_amount": (
                            str(band.band_amount) if band.band_amount is not None else None
                        ),
                        "rate": str(band.rate),
                    }
                    for band in rule.bands.order_by("sequence")
                ],
            }
            for rule in version.tax_rules.filter(active=True).prefetch_related("bands")
        ],
        "contribution_rules": [
            {
                "id": str(rule.id),
                "code": rule.code,
                "basis": rule.basis,
                "employee_rate": str(rule.employee_rate),
                "employer_rate": str(rule.employer_rate),
                "minimum_basis": (
                    str(rule.minimum_basis) if rule.minimum_basis is not None else None
                ),
                "maximum_basis": (
                    str(rule.maximum_basis) if rule.maximum_basis is not None else None
                ),
                "effective_from": rule.effective_from.isoformat(),
                "effective_to": rule.effective_to.isoformat() if rule.effective_to else None,
                "allocations": [
                    {
                        "code": allocation.code,
                        "rate": str(allocation.rate),
                        "destination_type": allocation.destination_type,
                        "destination_reference": allocation.destination_reference,
                    }
                    for allocation in rule.allocations.order_by("code")
                ],
            }
            for rule in version.contribution_rules.prefetch_related("allocations")
        ],
        "special_income_rules": [
            {
                "id": str(rule.id),
                "code": rule.code,
                "income_type": rule.income_type,
                "eligibility": rule.eligibility_json,
                "calculation": rule.calculation_json,
                "requires_validation": rule.requires_validation,
            }
            for rule in version.special_income_rules.order_by("code")
        ],
        "thresholds": [
            {
                "id": str(threshold.id),
                "code": threshold.code,
                "amount": str(threshold.amount),
                "unit": threshold.unit,
                "effective_from": threshold.effective_from.isoformat(),
                "effective_to": (
                    threshold.effective_to.isoformat() if threshold.effective_to else None
                ),
            }
            for threshold in version.statutory_thresholds.order_by("code", "effective_from")
        ],
        "relief_definitions": [
            {
                "id": str(definition.id),
                "code": definition.code,
                "calculation_method": definition.calculation_method,
                "default_amount": (
                    str(definition.default_amount)
                    if definition.default_amount is not None
                    else None
                ),
                "max_count": definition.max_count,
                "percentage": (
                    str(definition.percentage)
                    if definition.percentage is not None
                    else None
                ),
                "eligibility": definition.eligibility_json,
                "requires_evidence": definition.requires_evidence,
            }
            for definition in version.relief_definitions.order_by("code")
        ],
        "compliance_deadlines": [
            {
                "id": str(deadline.id),
                "code": deadline.code,
                "authority": deadline.authority,
                "event_type": deadline.event_type,
                "calculation_rule": deadline.calculation_rule,
                "offset_days": deadline.offset_days,
                "day_of_month": deadline.day_of_month,
                "effective_from": deadline.effective_from.isoformat(),
                "effective_to": (
                    deadline.effective_to.isoformat() if deadline.effective_to else None
                ),
            }
            for deadline in version.compliance_deadlines.order_by(
                "code", "effective_from"
            )
        ],
    }


@transaction.atomic
def calculate_payroll_run(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update(of=("self",)).select_related(
        "payroll_period", "preset_version__payroll_preset", "institution"
    ).get(pk=payroll_run.pk)
    _membership_with_permission(actor, run.institution, "payroll.prepare")
    if run.status == PayrollRun.Status.CALCULATED:
        return run
    if run.status == PayrollRun.Status.FINALIZED:
        raise CodedValidationError(
            {"status": "A finalized payroll run is immutable."},
            api_code="record_immutable",
        )
    if run.status != PayrollRun.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft payroll runs can be calculated."},
            api_code="invalid_state_transition",
        )
    configuration = getattr(run.institution, "payroll_configuration", None)
    if configuration is None or not configuration.is_configured:
        raise ValidationError({"institution": "Payroll configuration is incomplete."})
    snapshot_configuration = run.statutory_snapshot.get("configuration")
    current_configuration = _configuration_snapshot(configuration)
    if snapshot_configuration and snapshot_configuration != current_configuration:
        raise ValidationError(
            {"configuration": "Payroll configuration changed; cancel and create a new run."}
        )
    current_snapshot = _preset_snapshot(run, configuration)
    if run.statutory_snapshot and run.statutory_snapshot != current_snapshot:
        raise ValidationError(
            {"preset_version": "Payroll preset rules changed; cancel and create a new run."}
        )
    run.status = PayrollRun.Status.CALCULATING
    run.save(update_fields=("status", "updated_at"))
    if run.payroll_period.status == PayrollPeriod.Status.OPEN:
        run.payroll_period.status = PayrollPeriod.Status.PROCESSING
        run.payroll_period.save(update_fields=("status", "updated_at"))
    run.records.all().delete()
    employees = list(
        eligible_employees_for_payroll_run(
            institution=run.institution,
            payroll_run=run,
        )
    )
    if not employees:
        raise ValidationError({"employees": "No employees have compensation for this period."})
    if not run.statutory_snapshot:
        run.statutory_snapshot = _preset_snapshot(run, configuration)
    run.save(update_fields=("statutory_snapshot", "updated_at"))
    for employee in employees:
        calculate_employee_record(run, employee, configuration)
    for adjustment in run.applied_adjustments.filter(
        status=PayrollAdjustment.Status.APPLIED
    ):
        record_audit_event(
            actor=actor,
            institution=run.institution,
            entity=adjustment,
            action="payroll.adjustment.applied",
            metadata=_status_change_metadata(
                PayrollAdjustment.Status.APPROVED,
                PayrollAdjustment.Status.APPLIED,
                payroll_run_id=str(run.id),
            ),
        )
    run.status = PayrollRun.Status.CALCULATED
    run.save(update_fields=("status", "updated_at"))
    detect_payroll_exceptions(run)
    record_audit_event(
        actor=actor,
        institution=run.institution,
        entity=run,
        action="payroll.run.calculated",
        metadata=_status_change_metadata(
            PayrollRun.Status.DRAFT,
            PayrollRun.Status.CALCULATED,
            record_count=len(employees),
        ),
    )
    return run


@transaction.atomic
def submit_payroll_run_for_review(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
    _membership_with_permission(actor, run.institution, "payroll.prepare")
    if run.status == PayrollRun.Status.UNDER_REVIEW:
        return run
    if run.status != PayrollRun.Status.CALCULATED:
        raise CodedValidationError(
            {"status": "Only calculated runs can enter review."},
            api_code="invalid_state_transition",
        )
    blocking = run.exceptions.filter(
        status=PayrollRunException.Status.OPEN, severity=PayrollRunException.Severity.HIGH
    ).count()
    if blocking:
        raise CodedValidationError(
            {"exceptions": f"Resolve {blocking} high-severity payroll exception(s) before submitting for review."},
            api_code="payroll_exceptions_open",
        )
    run.status = PayrollRun.Status.UNDER_REVIEW
    run.save(update_fields=("status", "updated_at"))
    _notify_permission_holders(
        run.institution,
        "payroll.approve",
        "Payroll approval required",
        f"Payroll run {run.run_number} requires approval.",
        {"payroll_run_id": str(run.id)},
    )
    record_audit_event(
        actor=actor,
        institution=run.institution,
        entity=run,
        action="payroll.run.submitted_for_review",
        metadata=_status_change_metadata(
            PayrollRun.Status.CALCULATED, PayrollRun.Status.UNDER_REVIEW
        ),
    )
    return run


@transaction.atomic
def _ensure_payroll_separation(run, actor):
    """Preparer != approver when the institution's separation-of-duties setting is on (BQ-04)."""
    from apps.audit.models import AuditLog
    from apps.institutions.services import institution_setting

    if not (institution_setting(run.institution, "security.separation_of_duties") or {}).get("payroll", True):
        return
    prepared = run.started_by_id == actor.id or AuditLog.objects.filter(
        institution=run.institution, entity_id=run.id, actor=actor, action="payroll.run.submitted_for_review"
    ).exists()
    if prepared:
        raise CodedValidationError(
            {"actor": "You prepared this payroll run, so someone else must approve it (separation of duties)."},
            api_code="separation_of_duties",
        )


def approve_payroll_run(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
    _membership_with_permission(actor, run.institution, "payroll.approve")
    if run.status == PayrollRun.Status.APPROVED:
        return run
    if run.status != PayrollRun.Status.UNDER_REVIEW:
        raise CodedValidationError(
            {"status": "Only runs under review can be approved."},
            api_code="invalid_state_transition",
        )
    _ensure_payroll_separation(run, actor)
    reconciliation = reconcile_payroll_run(run)
    if reconciliation["discrepancy_count"]:
        raise ValidationError({"reconciliation": "Payroll contains reconciliation discrepancies."})
    run.status = PayrollRun.Status.APPROVED
    run.approved_by = actor
    run.approved_at = timezone.now()
    run.save(update_fields=("status", "approved_by", "approved_at", "updated_at"))
    _notify_permission_holders(
        run.institution,
        "payroll.finalize",
        "Payroll finalization required",
        f"Approved payroll run {run.run_number} is ready for finalization.",
        {"payroll_run_id": str(run.id)},
    )
    record_audit_event(
        actor=actor,
        institution=run.institution,
        entity=run,
        action="payroll.run.approved",
        metadata=_status_change_metadata(
            PayrollRun.Status.UNDER_REVIEW, PayrollRun.Status.APPROVED
        ),
    )
    return run


def payslip_payload(record):
    return {
        "payroll_run_id": str(record.payroll_run_id),
        "payroll_record_id": str(record.id),
        "employee_id": str(record.employee_id),
        "currency": record.currency,
        "gross_pay": str(record.gross_pay),
        "taxable_income": str(record.taxable_income),
        "total_deductions": str(record.total_deductions),
        "employee_contributions": str(record.employee_contributions),
        "employer_contributions": str(record.employer_contributions),
        "net_pay": str(record.net_pay),
        "items": [
            {
                "code": item.component_code_snapshot,
                "name": item.component_name_snapshot,
                "source": item.source,
                "quantity": str(item.quantity) if item.quantity is not None else None,
                "rate": str(item.rate) if item.rate is not None else None,
                "amount": str(item.amount),
                "metadata": item.metadata,
            }
            for item in record.items.order_by("created_at")
        ],
    }


def compliance_deadlines_for_period(payroll_period):
    deadlines = effective_compliance_deadlines_for_period(
        institution=payroll_period.institution,
        payroll_period=payroll_period,
    )
    results = []
    for deadline in deadlines:
        anchor = deadline.calculation_rule.get("anchor", "PERIOD_END")
        if anchor == "FOLLOWING_MONTH":
            if payroll_period.end_date.month == 12:
                anchor_date = date(payroll_period.end_date.year + 1, 1, 1)
            else:
                anchor_date = date(
                    payroll_period.end_date.year,
                    payroll_period.end_date.month + 1,
                    1,
                )
        elif anchor == "PERIOD_END":
            anchor_date = payroll_period.end_date
        else:
            raise ValidationError(
                {"compliance_deadline": f"Unsupported deadline anchor {anchor}."}
            )
        if deadline.day_of_month is not None:
            last_day = monthrange(anchor_date.year, anchor_date.month)[1]
            due_date = anchor_date.replace(day=min(deadline.day_of_month, last_day))
        else:
            due_date = anchor_date + timedelta(days=deadline.offset_days or 0)
        results.append(
            {
                "compliance_deadline_id": deadline.id,
                "code": deadline.code,
                "authority": deadline.authority,
                "event_type": deadline.event_type,
                "due_date": due_date,
            }
        )
    return results


@transaction.atomic
def finalize_payroll_run(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().select_related("payroll_period").get(
        pk=payroll_run.pk
    )
    _membership_with_permission(actor, run.institution, "payroll.finalize")
    if run.status == PayrollRun.Status.FINALIZED:
        return run
    if run.status != PayrollRun.Status.APPROVED:
        raise CodedValidationError(
            {"status": "Only approved runs can be finalized."},
            api_code="invalid_state_transition",
        )
    reconciliation = reconcile_payroll_run(run)
    if reconciliation["discrepancy_count"]:
        raise ValidationError({"reconciliation": "Payroll contains reconciliation discrepancies."})
    if not run.records.exists():
        raise ValidationError({"records": "A payroll run cannot finalize without records."})

    run.records.update(status="FINALIZED", updated_at=timezone.now())
    run.status = PayrollRun.Status.FINALIZED
    run.finalized_by = actor
    run.finalized_at = timezone.now()
    run.save(update_fields=("status", "finalized_by", "finalized_at", "updated_at"))
    for record in run.records.select_related("employee__user").prefetch_related("items"):
        payload = payslip_payload(record)
        checksum = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        payslip, _ = Payslip.objects.get_or_create(
            institution=run.institution,
            payroll_record=record,
            defaults={"generated_at": timezone.now(), "checksum": checksum},
        )
        _notify(
            record.employee.user,
            run.institution,
            "PAYSLIP_AVAILABLE",
            "Payslip available",
            f"Your payslip for {run.payroll_period.name} is available.",
            {"payslip_id": str(payslip.id)},
        )
    for deadline in compliance_deadlines_for_period(run.payroll_period):
        _notify_permission_holders(
            run.institution,
            "payroll.finalize",
            f"{deadline['authority']} deadline",
            (
                f"{deadline['event_type']} for {run.payroll_period.name} is due "
                f"on {deadline['due_date'].isoformat()}."
            ),
            {
                "payroll_run_id": str(run.id),
                "compliance_deadline_id": str(deadline["compliance_deadline_id"]),
                "due_date": deadline["due_date"].isoformat(),
            },
            notification_type="PAYROLL_COMPLIANCE_DEADLINE",
        )
    run.payroll_period.status = PayrollPeriod.Status.CLOSED
    run.payroll_period.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=run.institution,
        entity=run,
        action="payroll.run.finalized",
        metadata=_status_change_metadata(
            PayrollRun.Status.APPROVED,
            PayrollRun.Status.FINALIZED,
            payslip_count=run.records.count(),
        ),
    )
    return run


@transaction.atomic
def cancel_payroll_run(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().select_related("payroll_period").get(
        pk=payroll_run.pk
    )
    _membership_with_permission(actor, run.institution, "payroll.prepare")
    if run.status == PayrollRun.Status.CANCELLED:
        return run
    if run.status == PayrollRun.Status.FINALIZED:
        raise CodedValidationError(
            {"status": "A finalized payroll run is immutable."},
            api_code="record_immutable",
        )
    if run.status == PayrollRun.Status.APPROVED:
        raise CodedValidationError(
            {"status": "Approved payroll runs cannot be cancelled."},
            api_code="invalid_state_transition",
        )
    previous_status = run.status
    reverted_adjustments = list(
        run.applied_adjustments.filter(status=PayrollAdjustment.Status.APPLIED)
    )
    run.applied_adjustments.filter(status=PayrollAdjustment.Status.APPLIED).update(
        status=PayrollAdjustment.Status.APPROVED,
        applied_run=None,
        updated_at=timezone.now(),
    )
    for adjustment in reverted_adjustments:
        record_audit_event(
            actor=actor,
            institution=run.institution,
            entity=adjustment,
            action="payroll.adjustment.unapplied",
            metadata=_status_change_metadata(
                PayrollAdjustment.Status.APPLIED,
                PayrollAdjustment.Status.APPROVED,
                payroll_run_id=str(run.id),
            ),
        )
    run.status = PayrollRun.Status.CANCELLED
    run.save(update_fields=("status", "updated_at"))
    if not run.payroll_period.runs.exclude(status=PayrollRun.Status.CANCELLED).exists():
        run.payroll_period.status = PayrollPeriod.Status.OPEN
        run.payroll_period.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=run.institution,
        entity=run,
        action="payroll.run.cancelled",
        metadata=_status_change_metadata(
            previous_status, PayrollRun.Status.CANCELLED
        ),
    )
    return run


def reconcile_payroll_run(payroll_run):
    discrepancies = []
    source_totals = {}
    component_totals = {}
    records = payroll_records_with_items(
        institution=payroll_run.institution,
        payroll_run=payroll_run,
    )
    for record in records:
        recalculated = {
            "gross_pay": Decimal("0"),
            "taxable_income": Decimal("0"),
            "total_deductions": Decimal("0"),
            "employee_contributions": Decimal("0"),
            "employer_contributions": Decimal("0"),
        }
        for item in record.items.all():
            source_totals[item.source] = source_totals.get(item.source, Decimal("0")) + item.amount
            component_totals[item.component_code_snapshot] = (
                component_totals.get(item.component_code_snapshot, Decimal("0")) + item.amount
            )
            effect = item.metadata.get("effect")
            if effect == "EARNING":
                recalculated["gross_pay"] += item.amount
                if item.metadata.get("taxable"):
                    recalculated["taxable_income"] += item.amount
            elif effect == "DEDUCTION":
                recalculated["total_deductions"] += item.amount
            elif effect == "EMPLOYEE_CONTRIBUTION":
                recalculated["employee_contributions"] += item.amount
            elif effect == "EMPLOYER_CONTRIBUTION":
                recalculated["employer_contributions"] += item.amount
        recalculated["net_pay"] = (
            recalculated["gross_pay"]
            - recalculated["total_deductions"]
            - recalculated["employee_contributions"]
        )
        for field, value in recalculated.items():
            if money(getattr(record, field)) != money(value):
                discrepancies.append(
                    {
                        "payroll_record_id": str(record.id),
                        "employee_id": str(record.employee_id),
                        "field": field,
                        "stored": str(getattr(record, field)),
                        "calculated": str(money(value)),
                    }
                )
    totals = records.aggregate(
        gross_pay=Sum("gross_pay"),
        total_deductions=Sum("total_deductions"),
        employee_contributions=Sum("employee_contributions"),
        employer_contributions=Sum("employer_contributions"),
        net_pay=Sum("net_pay"),
    )
    return {
        "payroll_run_id": payroll_run.id,
        "status": payroll_run.status,
        "record_count": records.count(),
        "totals": {key: value or Decimal("0") for key, value in totals.items()},
        "source_totals": source_totals,
        "component_totals": component_totals,
        "discrepancy_count": len(discrepancies),
        "discrepancies": discrepancies,
    }


@transaction.atomic
def create_payroll_adjustment(*, institution, actor, **values):
    _membership_with_permission(actor, institution, "payroll.prepare")
    adjustment = PayrollAdjustment(
        institution=institution,
        created_by=actor,
        status=PayrollAdjustment.Status.DRAFT,
        **values,
    )
    adjustment.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=adjustment,
        action="payroll.adjustment.created",
    )
    record_user_activity(
        actor=actor,
        institution=institution,
        activity_code="payroll.adjustment",
        entity=adjustment,
    )
    return adjustment


@transaction.atomic
def submit_payroll_adjustment(*, adjustment, actor):
    adjustment = PayrollAdjustment.objects.select_for_update().get(pk=adjustment.pk)
    _membership_with_permission(actor, adjustment.institution, "payroll.prepare")
    if adjustment.status == PayrollAdjustment.Status.PENDING:
        return adjustment
    if adjustment.status != PayrollAdjustment.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft adjustments can be submitted."},
            api_code="invalid_state_transition",
        )
    if adjustment.payroll_period.status == PayrollPeriod.Status.CLOSED:
        raise CodedValidationError(
            {"payroll_period": "Closed periods cannot accept adjustments."},
            api_code="period_closed",
        )
    adjustment.status = PayrollAdjustment.Status.PENDING
    adjustment.save(update_fields=("status", "updated_at"))
    _notify_permission_holders(
        adjustment.institution,
        "payroll.approve",
        "Payroll adjustment approval required",
        f"A payroll adjustment for {adjustment.employee.full_name} requires approval.",
        {"payroll_adjustment_id": str(adjustment.id)},
    )
    record_audit_event(
        actor=actor,
        institution=adjustment.institution,
        entity=adjustment,
        action="payroll.adjustment.submitted",
        metadata=_status_change_metadata(
            PayrollAdjustment.Status.DRAFT, PayrollAdjustment.Status.PENDING
        ),
    )
    record_user_activity(
        actor=actor,
        institution=adjustment.institution,
        activity_code="payroll.adjustment",
        entity=adjustment,
    )
    return adjustment


@transaction.atomic
def decide_payroll_adjustment(*, adjustment, actor, approve):
    adjustment = PayrollAdjustment.objects.select_for_update().get(pk=adjustment.pk)
    _membership_with_permission(actor, adjustment.institution, "payroll.approve")
    decided_status = (
        PayrollAdjustment.Status.APPROVED if approve else PayrollAdjustment.Status.REJECTED
    )
    if adjustment.status == decided_status:
        return adjustment
    if adjustment.status != PayrollAdjustment.Status.PENDING:
        raise CodedValidationError(
            {"status": "Only pending adjustments can be decided."},
            api_code="invalid_state_transition",
        )
    adjustment.status = decided_status
    adjustment.approved_by = actor
    adjustment.save(update_fields=("status", "approved_by", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=adjustment.institution,
        entity=adjustment,
        action=(
            "payroll.adjustment.approved" if approve else "payroll.adjustment.rejected"
        ),
        metadata=_status_change_metadata(
            PayrollAdjustment.Status.PENDING, decided_status
        ),
    )
    record_user_activity(
        actor=actor,
        institution=adjustment.institution,
        activity_code="payroll.adjustment.review",
        entity=adjustment,
    )
    return adjustment


@transaction.atomic
def create_tax_relief_claim(*, institution, actor, employee, **values):
    membership = _membership_with_permission(actor, institution, "tax_relief.claim")
    if employee.institution_id != institution.id:
        raise CodedValidationError(
            {"employee": "Employee belongs to another institution."},
            api_code="tenant_mismatch",
        )
    if employee.user_id != actor.id and not membership.role.permissions.filter(
        code="tax_relief.approve"
    ).exists():
        raise ValidationError({"employee": "Employees may only claim their own relief."})
    configuration = getattr(institution, "payroll_configuration", None)
    relief_definition = values.get("relief_definition")
    if (
        configuration is None
        or configuration.payroll_setup_mode
        != InstitutionPayrollConfiguration.SetupMode.PRESET
        or configuration.selected_payroll_preset_version_id
        != relief_definition.preset_version_id
    ):
        raise ValidationError(
            {
                "relief_definition": (
                    "Relief must belong to the institution's selected payroll preset version."
                )
            }
        )
    eligibility = relief_definition.eligibility_json
    allowed_residencies = eligibility.get("tax_residency")
    if allowed_residencies:
        profile = EmployeePayrollProfile.objects.filter(employee=employee).first()
        if profile is None:
            raise ValidationError(
                {"employee": "Employee payroll profile is required for this relief."}
            )
        if profile.tax_residency not in allowed_residencies:
            raise ValidationError(
                {"relief_definition": "Employee is not eligible by tax residency."}
            )
    minimum_age = eligibility.get("minimum_age")
    if minimum_age is not None:
        if employee.date_of_birth is None:
            raise ValidationError(
                {"employee": "Date of birth is required for this relief."}
            )
        tax_year = values["tax_year"]
        age_at_year_end = tax_year - employee.date_of_birth.year
        if age_at_year_end < int(minimum_age):
            raise ValidationError(
                {"relief_definition": "Employee does not meet the minimum age."}
            )
    maximum_amount = None
    if relief_definition.calculation_method == "FIXED_ANNUAL":
        maximum_amount = relief_definition.default_amount
    elif relief_definition.calculation_method == "FIXED_PER_DEPENDENT":
        maximum_amount = (
            relief_definition.default_amount * relief_definition.max_count
            if relief_definition.default_amount is not None
            and relief_definition.max_count is not None
            else None
        )
    if maximum_amount is not None and values["claimed_amount"] > maximum_amount:
        raise ValidationError(
            {
                "claimed_amount": (
                    f"Claim exceeds the configured maximum of {maximum_amount}."
                )
            }
        )
    claim = EmployeeTaxReliefClaim(
        institution=institution,
        employee=employee,
        status=EmployeeTaxReliefClaim.Status.DRAFT,
        **values,
    )
    claim.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=claim,
        action="payroll.tax_relief_claim.created",
    )
    return claim


@transaction.atomic
def submit_tax_relief_claim(*, claim, actor):
    claim = EmployeeTaxReliefClaim.objects.select_for_update().get(pk=claim.pk)
    membership = _membership_with_permission(actor, claim.institution, "tax_relief.claim")
    if claim.employee.user_id != actor.id and not membership.role.permissions.filter(
        code="tax_relief.approve"
    ).exists():
        raise ValidationError({"employee": "Employees may only submit their own relief claim."})
    if claim.status == EmployeeTaxReliefClaim.Status.PENDING:
        return claim
    if claim.status != EmployeeTaxReliefClaim.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft claims can be submitted."},
            api_code="invalid_state_transition",
        )
    claim.status = EmployeeTaxReliefClaim.Status.PENDING
    claim.save(update_fields=("status", "updated_at"))
    _notify_permission_holders(
        claim.institution,
        "tax_relief.approve",
        "Tax-relief claim review required",
        f"A tax-relief claim for {claim.employee.full_name} requires review.",
        {"tax_relief_claim_id": str(claim.id)},
        notification_type="TAX_RELIEF_ACTION_REQUIRED",
    )
    record_audit_event(
        actor=actor,
        institution=claim.institution,
        entity=claim,
        action="payroll.tax_relief_claim.submitted",
        metadata=_status_change_metadata(
            EmployeeTaxReliefClaim.Status.DRAFT,
            EmployeeTaxReliefClaim.Status.PENDING,
        ),
    )
    return claim


@transaction.atomic
def decide_tax_relief_claim(*, claim, actor, approve, approved_amount=None):
    claim = EmployeeTaxReliefClaim.objects.select_for_update().get(pk=claim.pk)
    _membership_with_permission(actor, claim.institution, "tax_relief.approve")
    decided_status = (
        EmployeeTaxReliefClaim.Status.APPROVED
        if approve
        else EmployeeTaxReliefClaim.Status.REJECTED
    )
    if claim.status == decided_status and (
        not approve
        or approved_amount is None
        or approved_amount == claim.approved_amount
    ):
        return claim
    if claim.status != EmployeeTaxReliefClaim.Status.PENDING:
        raise CodedValidationError(
            {"status": "Only pending claims can be decided."},
            api_code="invalid_state_transition",
        )
    if approve:
        claim.status = EmployeeTaxReliefClaim.Status.APPROVED
        claim.approved_amount = (
            approved_amount if approved_amount is not None else claim.claimed_amount
        )
        definition = claim.relief_definition
        maximum_amount = None
        if definition.calculation_method == "FIXED_ANNUAL":
            maximum_amount = definition.default_amount
        elif definition.calculation_method == "FIXED_PER_DEPENDENT":
            maximum_amount = (
                definition.default_amount * definition.max_count
                if definition.default_amount is not None
                and definition.max_count is not None
                else None
            )
        if maximum_amount is not None and claim.approved_amount > maximum_amount:
            raise ValidationError(
                {
                    "approved_amount": (
                        f"Approved amount exceeds the configured maximum of {maximum_amount}."
                    )
                }
            )
    else:
        claim.status = EmployeeTaxReliefClaim.Status.REJECTED
        claim.approved_amount = Decimal("0")
    claim.approved_by = actor
    claim.approved_at = timezone.now()
    claim.save(
        update_fields=(
            "status",
            "approved_amount",
            "approved_by",
            "approved_at",
            "updated_at",
        )
    )
    notification_status = "approved" if approve else "rejected"
    _notify(
        claim.employee.user,
        claim.institution,
        f"TAX_RELIEF_CLAIM_{decided_status}",
        f"Tax-relief claim {notification_status}",
        f"Your {claim.relief_definition.name} claim was {notification_status}.",
        {
            "tax_relief_claim_id": str(claim.id),
            "status": decided_status,
            "approved_amount": str(money(claim.approved_amount)),
        },
    )
    record_audit_event(
        actor=actor,
        institution=claim.institution,
        entity=claim,
        action=(
            "payroll.tax_relief_claim.approved"
            if approve
            else "payroll.tax_relief_claim.rejected"
        ),
        metadata=_status_change_metadata(
            EmployeeTaxReliefClaim.Status.PENDING,
            decided_status,
            approved_amount=str(money(claim.approved_amount)),
        ),
    )
    return claim


LARGE_NET_CHANGE_RATIO = Decimal("0.25")


def detect_payroll_exceptions(run):
    """(Re)compute a calculated run's exceptions.

    New issues are opened, issues that disappeared are resolved automatically,
    and acknowledged or resolved decisions on issues that persist are kept.
    """
    from apps.employees.models import Employee

    detected = {}

    def add(code, severity, message, employee=None, **details):
        detected[(code, employee.id if employee else None)] = (code, severity, message, employee, details)

    records = list(run.records.select_related("employee"))
    for record in records:
        if record.status == PayrollRecord.Status.ERROR:
            add(PayrollRunException.Code.CALCULATION_ERROR, PayrollRunException.Severity.HIGH, "Payroll record could not be calculated.", record.employee)
        if record.net_pay <= 0:
            add(PayrollRunException.Code.NON_POSITIVE_NET_PAY, PayrollRunException.Severity.HIGH, f"Net pay is {record.net_pay} {record.currency}.", record.employee, net_pay=str(record.net_pay))

    for discrepancy in reconcile_payroll_run(run)["discrepancies"]:
        employee = next((record.employee for record in records if str(record.employee_id) == discrepancy["employee_id"]), None)
        add(
            PayrollRunException.Code.RECONCILIATION_DISCREPANCY, PayrollRunException.Severity.HIGH,
            f"{discrepancy['field'].replace('_', ' ').capitalize()} stored {discrepancy['stored']} but items total {discrepancy['calculated']}.",
            employee, **discrepancy,
        )

    previous_run = (
        PayrollRun.objects.filter(institution=run.institution, status=PayrollRun.Status.FINALIZED)
        .exclude(pk=run.pk)
        .filter(payroll_period__start_date__lt=run.payroll_period.start_date)
        .order_by("-payroll_period__start_date", "-run_number")
        .first()
    )
    if previous_run:
        previous_net = dict(previous_run.records.values_list("employee_id", "net_pay"))
        for record in records:
            before = previous_net.get(record.employee_id)
            if before and before > 0 and abs(record.net_pay - before) / before > LARGE_NET_CHANGE_RATIO:
                change = (record.net_pay - before) / before * 100
                add(
                    PayrollRunException.Code.LARGE_NET_PAY_CHANGE, PayrollRunException.Severity.MEDIUM,
                    f"Net pay changed {change:+.0f}% from the previous finalized run ({before} to {record.net_pay}).",
                    record.employee, previous=str(before), current=str(record.net_pay),
                )

    included = {record.employee_id for record in records}
    for employee in Employee.objects.filter(
        institution=run.institution, status=Employee.Status.ACTIVE, hire_date__lte=run.payroll_period.end_date,
        employments__is_current=True,
    ).exclude(id__in=included).distinct():
        add(PayrollRunException.Code.NOT_IN_RUN, PayrollRunException.Severity.MEDIUM, "Active employee has no payroll record in this run (no compensation for the period).", employee)

    with_profile = set(
        EmployeePayrollProfile.objects.filter(institution=run.institution, employee_id__in=included).values_list("employee_id", flat=True)
    )
    for record in records:
        if record.employee_id not in with_profile:
            add(PayrollRunException.Code.MISSING_PAYROLL_PROFILE, PayrollRunException.Severity.LOW, "Employee payroll profile (tax residency and identifiers) is not configured.", record.employee)

    existing = {(item.code, item.employee_id): item for item in run.exceptions.all()}
    now = timezone.now()
    for key, (code, severity, message, employee, details) in detected.items():
        item = existing.get(key)
        if item is None:
            PayrollRunException.objects.create(
                institution=run.institution, payroll_run=run, employee=employee,
                code=code, severity=severity, message=message, details=_json_safe(details),
            )
        else:
            item.severity, item.message, item.details = severity, message, _json_safe(details)
            if item.status == PayrollRunException.Status.RESOLVED and item.resolved_by_id is None:
                item.status = PayrollRunException.Status.OPEN
                item.resolution_note = ""
                item.resolved_at = None
            item.save()
    for key, item in existing.items():
        if key not in detected and item.status != PayrollRunException.Status.RESOLVED:
            item.status = PayrollRunException.Status.RESOLVED
            item.resolution_note = "No longer detected on revalidation."
            item.resolved_by = None
            item.resolved_at = now
            item.save(update_fields=("status", "resolution_note", "resolved_by", "resolved_at", "updated_at"))
    return run.exceptions.all()


def _json_safe(details):
    return {key: str(value) if not isinstance(value, (str, int, float, bool, type(None))) else value for key, value in details.items()}


@transaction.atomic
def revalidate_payroll_run(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().get(pk=payroll_run.pk)
    _membership_with_permission(actor, run.institution, "payroll.prepare")
    if run.status not in {PayrollRun.Status.CALCULATED, PayrollRun.Status.UNDER_REVIEW}:
        raise CodedValidationError(
            {"status": "Only calculated or in-review runs can be validated."}, api_code="invalid_state_transition"
        )
    detect_payroll_exceptions(run)
    record_audit_event(actor=actor, institution=run.institution, entity=run, action="payroll.run.validated",
                       metadata={"open_exceptions": run.exceptions.filter(status=PayrollRunException.Status.OPEN).count()})
    return run


@transaction.atomic
def update_payroll_exception(*, exception, actor, status, note=""):
    exception = PayrollRunException.objects.select_for_update().select_related("payroll_run").get(pk=exception.pk)
    _membership_with_permission(actor, exception.institution, "payroll.prepare")
    if exception.payroll_run.status in {PayrollRun.Status.FINALIZED, PayrollRun.Status.CANCELLED}:
        raise ValidationError({"payroll_run": "Exceptions on finalized or cancelled runs are read-only."})
    if status not in PayrollRunException.Status.values:
        raise ValidationError({"status": "Unknown exception status."})
    if status == PayrollRunException.Status.ACKNOWLEDGED and exception.severity == PayrollRunException.Severity.HIGH:
        raise ValidationError({"status": "High-severity exceptions must be resolved, not acknowledged."})
    if status != PayrollRunException.Status.OPEN and not (note or "").strip():
        raise ValidationError({"note": "Record how the exception was handled."})
    before = exception.status
    exception.status = status
    exception.resolution_note = (note or "").strip() if status != PayrollRunException.Status.OPEN else ""
    exception.resolved_by = actor if status != PayrollRunException.Status.OPEN else None
    exception.resolved_at = timezone.now() if status != PayrollRunException.Status.OPEN else None
    exception.save(update_fields=("status", "resolution_note", "resolved_by", "resolved_at", "updated_at"))
    record_audit_event(
        actor=actor, institution=exception.institution, entity=exception.payroll_run,
        action="payroll.exception.updated",
        metadata={"exception_id": str(exception.id), "code": exception.code, "from": before, "to": status, "note": exception.resolution_note},
    )
    return exception
