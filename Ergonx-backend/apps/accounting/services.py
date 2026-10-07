from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.accounting.models import (
    Account,
    AccountTemplate,
    AccountingPresetVersion,
    AccountingPeriod,
    ChartOfAccountsTemplate,
    FiscalYear,
    InstitutionAccountingConfiguration,
    JournalEntry,
    JournalLine,
    TaxComponent,
    WithholdingRule,
    Vendor,
    VendorBill,
    VendorBillLine,
    Customer,
    Invoice,
    InvoiceLine,
    BankAccount,
    Payment,
    Receipt,
    BankStatementLine,
    VATWithholdingCertificate,
    Expense,
    PayrollAccountMappingTemplate,
    PayComponentAccountMapping,
)
from apps.compensation.models import PayComponent
from apps.payroll.models import PayrollRun
from apps.accounting.selectors import account_templates_for_application
from apps.audit.models import AuditLog
from apps.audit.services import record_audit_event
from apps.institutions.models import Institution, InstitutionModule
from apps.institutions.services import record_user_activity
from apps.notifications.models import Notification
from common.exceptions import CodedValidationError


def _require(actor, institution, permission_code):
    membership = actor.memberships.filter(
        institution=institution, status="ACTIVE"
    ).select_related("role").first()
    if membership is None or not membership.role.permissions.filter(
        code=permission_code
    ).exists():
        raise CodedValidationError(
            {"actor": f"Actor lacks {permission_code}."}, api_code="permission_denied"
        )
    return membership


def _notify_permission_holders(institution, permission_code, title, message, metadata):
    memberships = institution.memberships.filter(
        status="ACTIVE", role__permissions__code=permission_code
    ).select_related("user").distinct()
    for membership in memberships:
        Notification.objects.create(
            institution=institution,
            user=membership.user,
            notification_type="ACCOUNTING_ACTION_REQUIRED",
            title=title,
            message=message,
            channel=Notification.Channel.IN_APP,
            metadata=metadata,
        )


def _transition(before, after, **metadata):
    return {"before": {"status": before}, "after": {"status": after}, **metadata}


_MONEY = Decimal("0.01")


def _money(value):
    return Decimal(value).quantize(_MONEY, rounding=ROUND_HALF_UP)


@transaction.atomic
def configure_accounting(*, institution, actor, _preset_application=False, **values):
    _require(actor, institution, "accounting.configure")
    configuration = InstitutionAccountingConfiguration.objects.select_for_update().filter(
        institution=institution
    ).first()
    before = None
    if configuration is None:
        configuration = InstitutionAccountingConfiguration(institution=institution)
    else:
        before = {
            "country_code": configuration.country_code,
            "base_currency": configuration.base_currency,
            "accounting_setup_mode": configuration.accounting_setup_mode,
            "reporting_framework": configuration.reporting_framework,
            "fiscal_year_start_month": configuration.fiscal_year_start_month,
            "is_configured": configuration.is_configured,
        }
    target_mode = values.get(
        "accounting_setup_mode", configuration.accounting_setup_mode
    )
    target_version = values.get(
        "selected_accounting_preset_version",
        configuration.selected_accounting_preset_version,
    )
    if target_mode == InstitutionAccountingConfiguration.SetupMode.PRESET:
        unchanged_applied_preset = (
            configuration.pk
            and configuration.accounting_setup_mode
            == InstitutionAccountingConfiguration.SetupMode.PRESET
            and configuration.selected_accounting_preset_version_id
            == getattr(target_version, "id", None)
        )
        if not _preset_application and not unchanged_applied_preset:
            raise CodedValidationError(
                {
                    "accounting_setup_mode": (
                        "Use the preset apply action to instantiate and select a preset."
                    )
                },
                api_code="invalid_state_transition",
            )
    for field, value in values.items():
        setattr(configuration, field, value)
    configuration.country_code = configuration.country_code.strip().upper()
    configuration.base_currency = configuration.base_currency.strip().upper()
    configuration.configured_by = actor
    configuration.configured_at = timezone.now()
    configuration.full_clean()
    configuration.save()
    after = {
        "country_code": configuration.country_code,
        "base_currency": configuration.base_currency,
        "accounting_setup_mode": configuration.accounting_setup_mode,
        "reporting_framework": configuration.reporting_framework,
        "fiscal_year_start_month": configuration.fiscal_year_start_month,
        "is_configured": configuration.is_configured,
    }
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=configuration,
        action="accounting.configuration.changed",
        metadata={"before": before, "after": after},
    )
    return configuration


@transaction.atomic
def apply_accounting_preset(
    *,
    institution,
    actor,
    preset_version,
    base_currency,
    fiscal_year_start_month,
    coa_template=None,
):
    _require(actor, institution, "accounting.configure")
    Institution.objects.select_for_update().get(pk=institution.pk)
    preset_version = AccountingPresetVersion.objects.select_for_update().select_related(
        "accounting_preset"
    ).get(pk=preset_version.pk)
    today = timezone.localdate()
    if preset_version.status != AccountingPresetVersion.Status.ACTIVE:
        raise CodedValidationError(
            {"preset_version": "Only active accounting preset versions can be applied."},
            api_code="invalid_state_transition",
        )
    if preset_version.effective_from > today or (
        preset_version.effective_to and preset_version.effective_to < today
    ):
        raise CodedValidationError(
            {"preset_version": "Accounting preset version is not currently effective."},
            api_code="policy_not_applicable",
        )
    if preset_version.accounting_preset.country_code != institution.country_code:
        raise CodedValidationError(
            {"preset_version": "Accounting preset country does not match the institution."},
            api_code="policy_not_applicable",
        )

    chart, template_queryset = account_templates_for_application(
        preset_version=preset_version, coa_template=coa_template
    )
    templates = list(template_queryset)
    configuration = InstitutionAccountingConfiguration.objects.select_for_update().filter(
        institution=institution
    ).first()
    if (
        configuration
        and configuration.accounting_setup_mode
        == InstitutionAccountingConfiguration.SetupMode.PRESET
        and configuration.selected_accounting_preset_version_id != preset_version.id
    ):
        raise CodedValidationError(
            {
                "preset_version": (
                    "Preset version migration requires an explicit review workflow."
                )
            },
            api_code="invalid_state_transition",
        )

    prior_application = AuditLog.objects.filter(
        institution=institution,
        action="accounting.preset.applied",
        entity_id=getattr(configuration, "id", None),
        metadata__preset_version_id=str(preset_version.id),
    ).order_by("-created_at").first()
    if (
        prior_application
        and configuration.accounting_setup_mode
        == InstitutionAccountingConfiguration.SetupMode.PRESET
        and configuration.selected_accounting_preset_version_id == preset_version.id
    ):
        if prior_application.metadata.get("coa_template_id") != str(chart.id):
            raise CodedValidationError(
                {"coa_template": "A different chart template was already applied."},
                api_code="invalid_state_transition",
            )
        account_codes = [template.code for template in templates]
        accounts = list(
            Account.objects.filter(
                institution=institution, code__in=account_codes
            ).order_by("code")
        )
        if len(accounts) != len(account_codes):
            raise CodedValidationError(
                {"accounts": "The applied chart is missing one or more accounts."},
                api_code="record_immutable",
            )
        return {
            "configuration": configuration,
            "coa_template": chart,
            "created_count": 0,
            "reused_count": len(accounts),
            "accounts": accounts,
        }

    existing = {
        account.code: account
        for account in Account.objects.select_for_update().filter(
            institution=institution,
            code__in=[template.code for template in templates],
        )
    }
    instantiated = {}
    created = []
    reused = []
    pending = {template.id: template for template in templates}
    while pending:
        progressed = False
        for template_id, template in list(pending.items()):
            if template.parent_template_id and template.parent_template_id not in instantiated:
                continue
            parent = instantiated.get(template.parent_template_id)
            account = existing.get(template.code)
            if account:
                expected = (
                    account.name == template.name
                    and account.account_type == template.account_type
                    and account.normal_balance == template.normal_balance
                    and account.is_postable == template.is_postable
                    and account.parent_id == getattr(parent, "id", None)
                )
                if not expected:
                    raise CodedValidationError(
                        {
                            "accounts": (
                                f"Account code {template.code} conflicts with the selected template."
                            )
                        },
                        api_code="duplicate_operation",
                    )
                if template.system_mapping_code and not account.system_mapping_code:
                    mapping = _free_mapping_code(institution, template.system_mapping_code)
                    if mapping:
                        Account.objects.filter(pk=account.pk).update(system_mapping_code=mapping)
                reused.append(account)
            else:
                account = Account(
                    institution=institution,
                    code=template.code,
                    name=template.name,
                    account_type=template.account_type,
                    parent=parent,
                    normal_balance=template.normal_balance,
                    is_postable=template.is_postable,
                    is_active=True,
                    # Durable provenance (BQ-09): posting resolves by mapping code, not account code.
                    system_mapping_code=_free_mapping_code(institution, template.system_mapping_code),
                )
                account.save()
                created.append(account)
            instantiated[template_id] = account
            del pending[template_id]
            progressed = True
        if not progressed:
            raise ValidationError(
                {"account_templates": "Template hierarchy is cyclic or incomplete."}
            )

    configuration = configure_accounting(
        institution=institution,
        actor=actor,
        country_code=preset_version.accounting_preset.country_code,
        base_currency=base_currency,
        accounting_setup_mode=InstitutionAccountingConfiguration.SetupMode.PRESET,
        selected_accounting_preset_version=preset_version,
        reporting_framework=preset_version.reporting_framework,
        fiscal_year_start_month=fiscal_year_start_month,
        is_configured=True,
        _preset_application=True,
    )
    accounts = sorted((*created, *reused), key=lambda account: account.code)
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=configuration,
        action="accounting.preset.applied",
        metadata={
            "preset_version_id": str(preset_version.id),
            "preset_version_code": preset_version.version_code,
            "coa_template_id": str(chart.id),
            "created_account_ids": [str(account.id) for account in created],
            "created_account_codes": [account.code for account in created],
            "reused_account_ids": [str(account.id) for account in reused],
            "reused_account_codes": [account.code for account in reused],
        },
    )
    return {
        "configuration": configuration,
        "coa_template": chart,
        "created_count": len(created),
        "reused_count": len(reused),
        "accounts": accounts,
    }


@transaction.atomic
def create_account(*, institution, actor, **values):
    _require(actor, institution, "account.create")
    account = Account(institution=institution, **values)
    account.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=account,
        action="accounting.account.created",
    )
    return account


@transaction.atomic
def update_account(*, account, actor, **values):
    account = Account.objects.select_for_update().get(pk=account.pk)
    _require(actor, account.institution, "account.update")
    if "system_mapping_code" in values:
        # Re-pointing a system role (CASH, EMPLOYEE_PAYABLE, ...) changes where postings land.
        _require(actor, account.institution, "accounting.configure")
    before = {field: getattr(account, field) for field in values}
    for field, value in values.items():
        setattr(account, field, value)
    account.save()
    record_audit_event(
        actor=actor,
        institution=account.institution,
        entity=account,
        action="accounting.account.updated",
        metadata={
            "before": {key: str(value) for key, value in before.items()},
            "after": {key: str(getattr(account, key)) for key in values},
        },
    )
    return account


@transaction.atomic
def create_fiscal_year(*, institution, actor, **values):
    _require(actor, institution, "accounting.configure")
    Institution.objects.select_for_update().get(pk=institution.pk)
    fiscal_year = FiscalYear(institution=institution, **values)
    fiscal_year.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=fiscal_year,
        action="accounting.fiscal_year.created",
    )
    return fiscal_year


@transaction.atomic
def create_accounting_period(*, institution, actor, **values):
    _require(actor, institution, "accounting.configure")
    values["fiscal_year"] = FiscalYear.objects.select_for_update().get(
        pk=values["fiscal_year"].pk
    )
    period = AccountingPeriod(institution=institution, **values)
    period.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=period,
        action="accounting.period.created",
    )
    return period


def journal_totals(journal):
    totals = journal.lines.aggregate(debit=Sum("debit"), credit=Sum("credit"))
    return {
        "debit": totals["debit"] or Decimal("0.00"),
        "credit": totals["credit"] or Decimal("0.00"),
    }


def _validate_balanced(journal):
    totals = journal_totals(journal)
    if not journal.lines.exists() or totals["debit"] != totals["credit"]:
        raise CodedValidationError(
            {"lines": "Journal debits and credits must be non-zero and equal."},
            api_code="unbalanced_journal",
        )
    return totals


def _audit_totals(totals):
    return {key: str(value) for key, value in totals.items()}


def _next_journal_number(institution, entry_date):
    Institution.objects.select_for_update().get(pk=institution.pk)
    prefix = f"JE-{entry_date.year}-"
    last = JournalEntry.objects.filter(
        institution=institution, journal_number__startswith=prefix
    ).order_by("journal_number").last()
    sequence = int(last.journal_number.rsplit("-", 1)[-1]) + 1 if last else 1
    return f"{prefix}{sequence:06d}"


def _replace_lines(journal, lines):
    journal.lines.all().delete()
    for values in lines:
        JournalLine.objects.create(journal_entry=journal, **values)


def _create_journal_record(
    *, institution, actor, lines, source=JournalEntry.Source.MANUAL, **values
):
    period = AccountingPeriod.objects.select_for_update().get(
        pk=values["accounting_period"].pk
    )
    values["accounting_period"] = period
    if period.institution_id != institution.id:
        raise CodedValidationError(
            {"accounting_period": "Period belongs to another institution."},
            api_code="tenant_mismatch",
        )
    if period.status != AccountingPeriod.Status.OPEN:
        raise CodedValidationError(
            {"accounting_period": "Closed or locked periods cannot accept journals."},
            api_code="period_closed",
        )
    journal = JournalEntry(
        institution=institution,
        created_by=actor,
        source=source,
        journal_number=_next_journal_number(institution, values["entry_date"]),
        **values,
    )
    journal.save()
    _replace_lines(journal, lines)
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=journal,
        action="accounting.journal.created",
        metadata={"line_count": len(lines)},
    )
    return journal


@transaction.atomic
def create_journal(*, institution, actor, lines, source=JournalEntry.Source.MANUAL, **values):
    _require(actor, institution, "journal.create")
    journal = _create_journal_record(
        institution=institution,
        actor=actor,
        lines=lines,
        source=source,
        **values,
    )
    if source == JournalEntry.Source.MANUAL:
        record_user_activity(
            actor=actor,
            institution=institution,
            activity_code="journal.create",
            entity=journal,
        )
    return journal


@transaction.atomic
def update_draft_journal(*, journal, actor, lines=None, **values):
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, journal.institution, "journal.create")
    if journal.status != JournalEntry.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft journals can be edited."},
            api_code="record_immutable",
        )
    target_period = values.get("accounting_period", journal.accounting_period)
    target_period = AccountingPeriod.objects.select_for_update().get(pk=target_period.pk)
    if "accounting_period" in values:
        values["accounting_period"] = target_period
    if target_period.status != AccountingPeriod.Status.OPEN:
        raise CodedValidationError(
            {"accounting_period": "Closed or locked periods cannot accept journals."},
            api_code="period_closed",
        )
    for field, value in values.items():
        setattr(journal, field, value)
    journal.save()
    if lines is not None:
        _replace_lines(journal, lines)
    record_audit_event(
        actor=actor,
        institution=journal.institution,
        entity=journal,
        action="accounting.journal.updated",
    )
    return journal


@transaction.atomic
def submit_journal(*, journal, actor):
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, journal.institution, "journal.create")
    if journal.status == JournalEntry.Status.PENDING_APPROVAL:
        return journal
    if journal.status != JournalEntry.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft journals can be submitted."},
            api_code="invalid_state_transition",
        )
    totals = _validate_balanced(journal)
    journal.status = JournalEntry.Status.PENDING_APPROVAL
    journal.save(update_fields=("status", "updated_at"))
    _notify_permission_holders(
        journal.institution,
        "journal.approve",
        "Journal approval required",
        f"Journal {journal.journal_number} requires approval.",
        {"journal_entry_id": str(journal.id)},
    )
    record_audit_event(
        actor=actor,
        institution=journal.institution,
        entity=journal,
        action="accounting.journal.submitted",
        metadata=_transition("DRAFT", "PENDING_APPROVAL", **_audit_totals(totals)),
    )
    return journal


@transaction.atomic
def approve_journal(*, journal, actor, system=False, upstream_approver=None):
    """Approve a pending journal.

    ``system`` marks journals generated from an already-governed record (bill,
    invoice, payment, receipt, reversal, expense). They stay auto-approved and
    record the upstream approver instead of applying separation of duties.
    """
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, journal.institution, "journal.approve")
    if journal.status == JournalEntry.Status.APPROVED:
        return journal
    if journal.status != JournalEntry.Status.PENDING_APPROVAL:
        raise CodedValidationError(
            {"status": "Only pending journals can be approved."},
            api_code="invalid_state_transition",
        )
    totals = _validate_balanced(journal)
    # Separation of duties (BQ-04): the creator of a manual journal cannot approve
    # it. Journals generated from governed records (payroll, AP, AR, expense,
    # cash) are exempt and record the upstream approver instead.
    from apps.institutions.services import institution_setting

    if not system and journal.source == JournalEntry.Source.MANUAL and (institution_setting(journal.institution, "security.separation_of_duties") or {}).get("journals", True) and journal.created_by_id == actor.id:
        raise CodedValidationError(
            {"actor": "You created this journal, so someone else must approve it (separation of duties)."},
            api_code="separation_of_duties",
        )
    journal.status = JournalEntry.Status.APPROVED
    journal.approved_by = actor
    journal.save(update_fields=("status", "approved_by", "updated_at"))
    _notify_permission_holders(
        journal.institution,
        "journal.post",
        "Journal posting required",
        f"Journal {journal.journal_number} is approved and ready to post.",
        {"journal_entry_id": str(journal.id)},
    )
    record_audit_event(
        actor=actor,
        institution=journal.institution,
        entity=journal,
        action="accounting.journal.approved",
        metadata=_transition(
            "PENDING_APPROVAL", "APPROVED", **_audit_totals(totals),
            **({"system_generated": True, "upstream_approver": str(upstream_approver.id) if upstream_approver else None} if system else {}),
        ),
    )
    return journal


@transaction.atomic
def post_journal(*, journal, actor):
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, journal.institution, "journal.post")
    if journal.status == JournalEntry.Status.POSTED:
        return journal
    if journal.status != JournalEntry.Status.APPROVED:
        raise CodedValidationError(
            {"status": "Only approved journals can be posted."},
            api_code="invalid_state_transition",
        )
    period = AccountingPeriod.objects.select_for_update().get(
        pk=journal.accounting_period_id
    )
    if period.status != AccountingPeriod.Status.OPEN:
        raise CodedValidationError(
            {"accounting_period": "Closed or locked periods cannot accept posting."},
            api_code="period_closed",
        )
    totals = _validate_balanced(journal)
    invalid_accounts = journal.lines.filter(
        models.Q(account__is_active=False) | models.Q(account__is_postable=False)
    )
    if invalid_accounts.exists():
        raise ValidationError({"lines": "All journal accounts must be active and postable."})
    JournalEntry.objects.filter(pk=journal.pk).update(
        status=JournalEntry.Status.POSTED,
        posted_by=actor,
        posted_at=timezone.now(),
        updated_at=timezone.now(),
    )
    journal.refresh_from_db()
    if journal.reversal_of_id:
        reversed_count = JournalEntry.objects.filter(
            pk=journal.reversal_of_id, status=JournalEntry.Status.POSTED
        ).update(status=JournalEntry.Status.REVERSED, updated_at=timezone.now())
        if reversed_count:
            record_audit_event(
                actor=actor,
                institution=journal.institution,
                entity=journal.reversal_of,
                action="accounting.journal.reversed",
                metadata=_transition(
                    JournalEntry.Status.POSTED,
                    JournalEntry.Status.REVERSED,
                    reversal_journal_id=str(journal.id),
                ),
            )
    record_audit_event(
        actor=actor,
        institution=journal.institution,
        entity=journal,
        action="accounting.journal.posted",
        metadata=_transition("APPROVED", "POSTED", **_audit_totals(totals)),
    )
    return journal


@transaction.atomic
def create_reversal(*, journal, actor, entry_date, accounting_period, description=None):
    original = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, original.institution, "journal.reverse")
    if original.status not in (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED):
        raise CodedValidationError(
            {"status": "Only posted journals can be reversed."},
            api_code="invalid_state_transition",
        )
    existing = original.reversals.first()
    if existing:
        return existing
    lines = [
        {
            "account": line.account,
            "description": line.description,
            "debit": line.credit,
            "credit": line.debit,
            "department": line.department,
            "location": line.location,
            "employee": line.employee,
            "cost_centre": line.cost_centre,
            "project": line.project,
            "fund": line.fund,
            "metadata": {**line.metadata, "reversal_of_line_id": str(line.id)},
        }
        for line in original.lines.select_related(
            "account", "department", "location", "employee"
        )
    ]
    reversal = _create_journal_record(
        institution=original.institution,
        actor=actor,
        lines=lines,
        source=original.source,
        accounting_period=accounting_period,
        entry_date=entry_date,
        description=description or f"Reversal of {original.journal_number}",
        reference=original.reference,
        reversal_of=original,
    )
    record_audit_event(
        actor=actor,
        institution=original.institution,
        entity=original,
        action="accounting.journal.reversal_created",
        metadata={"reversal_journal_id": str(reversal.id)},
    )
    return reversal


@transaction.atomic
def void_journal(*, journal, actor):
    journal = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    _require(actor, journal.institution, "journal.create")
    if journal.status == JournalEntry.Status.VOID:
        return journal
    if journal.status in (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED):
        raise CodedValidationError(
            {"status": "Posted journals must be reversed and cannot be voided."},
            api_code="record_immutable",
        )
    before = journal.status
    journal.status = JournalEntry.Status.VOID
    journal.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=journal.institution,
        entity=journal,
        action="accounting.journal.voided",
        metadata=_transition(before, JournalEntry.Status.VOID),
    )
    return journal


@transaction.atomic
def set_period_status(*, period, actor, status):
    FiscalYear.objects.select_for_update().get(pk=period.fiscal_year_id)
    period = AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    permission = (
        "accounting_period.reopen"
        if status == AccountingPeriod.Status.OPEN
        else "accounting_period.close"
    )
    _require(actor, period.institution, permission)
    if period.status == status:
        return period
    before = period.status
    if (
        status == AccountingPeriod.Status.OPEN
        and period.fiscal_year.status == FiscalYear.Status.CLOSED
    ):
        raise CodedValidationError(
            {"fiscal_year": "A period cannot be reopened after its fiscal year is closed."},
            api_code="invalid_state_transition",
        )
    if status != AccountingPeriod.Status.OPEN and period.journal_entries.exclude(
        status__in=(JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED, JournalEntry.Status.VOID)
    ).exists():
        raise CodedValidationError(
            {"journal_entries": "Resolve all unposted journals first."},
            api_code="invalid_state_transition",
        )
    period.status = status
    period.closed_by = None if status == AccountingPeriod.Status.OPEN else actor
    period.closed_at = None if status == AccountingPeriod.Status.OPEN else timezone.now()
    period.save(update_fields=("status", "closed_by", "closed_at", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=period.institution,
        entity=period,
        action=f"accounting.period.{status.lower()}",
        metadata=_transition(before, status),
    )
    return period


@transaction.atomic
def close_fiscal_year(*, fiscal_year, actor):
    fiscal_year = FiscalYear.objects.select_for_update().get(pk=fiscal_year.pk)
    _require(actor, fiscal_year.institution, "accounting_period.close")
    if fiscal_year.status == FiscalYear.Status.CLOSED:
        return fiscal_year
    if fiscal_year.periods.filter(status=AccountingPeriod.Status.OPEN).exists():
        raise CodedValidationError(
            {"periods": "Close or lock every accounting period before closing the fiscal year."},
            api_code="invalid_state_transition",
        )
    before = fiscal_year.status
    fiscal_year.status = FiscalYear.Status.CLOSED
    fiscal_year.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=fiscal_year.institution,
        entity=fiscal_year,
        action="accounting.fiscal_year.closed",
        metadata=_transition(before, FiscalYear.Status.CLOSED),
    )
    return fiscal_year


@transaction.atomic
def create_vendor(*, institution, actor, **values):
    _require(actor, institution, "vendor.create")
    vendor = Vendor(institution=institution, **values)
    vendor.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=vendor,
        action="accounting.vendor.created",
    )
    return vendor


@transaction.atomic
def update_vendor(*, vendor, actor, **values):
    vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
    _require(actor, vendor.institution, "vendor.update")
    before = {field: str(getattr(vendor, field)) for field in values}
    for field, value in values.items():
        setattr(vendor, field, value)
    vendor.save()
    record_audit_event(
        actor=actor,
        institution=vendor.institution,
        entity=vendor,
        action="accounting.vendor.updated",
        metadata={"before": before, "after": {field: str(getattr(vendor, field)) for field in values}},
    )
    return vendor


def _line_total(values):
    return _money(Decimal(values["quantity"]) * Decimal(values["unit_price"]))


def _tax_component_amounts(line):
    if not line.tax_code_id:
        return {}
    component_amounts = {}
    for component in TaxComponent.objects.filter(tax_code=line.tax_code).order_by(
        "sequence", "code"
    ):
        amount = _money(line.line_total * component.rate / Decimal("100"))
        component_amounts[component.input_account_mapping_code] = (
            component_amounts.get(component.input_account_mapping_code, Decimal("0"))
            + amount
        )
    return component_amounts


def _withholding_amount(line):
    if not line.withholding_rule_id:
        return Decimal("0")
    return _money(line.line_total * line.withholding_rule.rate / Decimal("100"))


def _refresh_vendor_bill_totals(bill):
    subtotal = Decimal("0")
    tax_total = Decimal("0")
    withholding_total = Decimal("0")
    for line in bill.lines.select_related("tax_code", "withholding_rule"):
        subtotal += line.line_total
        tax_total += sum(_tax_component_amounts(line).values(), Decimal("0"))
        withholding_total += _withholding_amount(line)
    bill.subtotal = _money(subtotal)
    bill.tax_total = _money(tax_total)
    bill.withholding_total = _money(withholding_total)
    bill.total_amount = _money(bill.subtotal + bill.tax_total)
    bill.amount_payable = _money(bill.total_amount - bill.withholding_total)
    bill.save(
        update_fields=(
            "subtotal",
            "tax_total",
            "withholding_total",
            "total_amount",
            "amount_payable",
            "updated_at",
        )
    )
    return bill


def _replace_vendor_bill_lines(bill, lines):
    bill.lines.all().delete()
    for values in lines:
        line = VendorBillLine(vendor_bill=bill, **values)
        line.line_total = _line_total(values)
        line.save()
    return _refresh_vendor_bill_totals(bill)


@transaction.atomic
def create_vendor_bill(*, institution, actor, lines, **values):
    _require(actor, institution, "vendor_bill.create")
    vendor = Vendor.objects.select_for_update().get(pk=values["vendor"].pk)
    period = AccountingPeriod.objects.select_for_update().get(
        pk=values["accounting_period"].pk
    )
    values["vendor"] = vendor
    values["accounting_period"] = period
    bill = VendorBill(institution=institution, **values)
    bill.save()
    _replace_vendor_bill_lines(bill, lines)
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=bill,
        action="accounting.vendor_bill.created",
        metadata={"line_count": len(lines), "totals": _audit_totals({"subtotal": bill.subtotal, "tax_total": bill.tax_total, "withholding_total": bill.withholding_total, "total_amount": bill.total_amount, "amount_payable": bill.amount_payable})},
    )
    return bill


@transaction.atomic
def update_draft_vendor_bill(*, bill, actor, lines=None, **values):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.create")
    if bill.status != VendorBill.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft vendor bills can be edited."},
            api_code="record_immutable",
        )
    before = {field: str(getattr(bill, field)) for field in values}
    if "vendor" in values:
        values["vendor"] = Vendor.objects.select_for_update().get(pk=values["vendor"].pk)
    if "accounting_period" in values:
        values["accounting_period"] = AccountingPeriod.objects.select_for_update().get(
            pk=values["accounting_period"].pk
        )
    for field, value in values.items():
        setattr(bill, field, value)
    bill.save()
    if lines is not None:
        _replace_vendor_bill_lines(bill, lines)
    else:
        for line in bill.lines.all():
            line.full_clean(validate_constraints=False)
        _refresh_vendor_bill_totals(bill)
    record_audit_event(
        actor=actor,
        institution=bill.institution,
        entity=bill,
        action="accounting.vendor_bill.updated",
        metadata={"before": before, "line_count": bill.lines.count()},
    )
    return bill


@transaction.atomic
def submit_vendor_bill(*, bill, actor):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.create")
    if bill.status == VendorBill.Status.PENDING:
        return bill
    if bill.status != VendorBill.Status.DRAFT:
        raise CodedValidationError(
            {"status": "Only draft vendor bills can be submitted."},
            api_code="invalid_state_transition",
        )
    if not bill.lines.exists():
        raise CodedValidationError(
            {"lines": "A vendor bill requires at least one line."},
            api_code="validation_error",
        )
    period = AccountingPeriod.objects.select_for_update().get(pk=bill.accounting_period_id)
    if period.status != AccountingPeriod.Status.OPEN:
        raise CodedValidationError(
            {"accounting_period": "Closed or locked periods cannot accept bills."},
            api_code="period_closed",
        )
    _refresh_vendor_bill_totals(bill)
    bill.status = VendorBill.Status.PENDING
    bill.submitted_by = actor
    bill.submitted_at = timezone.now()
    bill.rejection_reason = ""
    bill.save(update_fields=("status", "submitted_by", "submitted_at", "rejection_reason", "updated_at"))
    _notify_permission_holders(
        bill.institution,
        "vendor_bill.approve",
        "Vendor bill approval required",
        f"Vendor bill {bill.bill_number} requires approval.",
        {"vendor_bill_id": str(bill.id)},
    )
    record_audit_event(
        actor=actor,
        institution=bill.institution,
        entity=bill,
        action="accounting.vendor_bill.submitted",
        metadata=_transition("DRAFT", "PENDING", **_audit_totals({"total_amount": bill.total_amount, "amount_payable": bill.amount_payable})),
    )
    return bill


@transaction.atomic
def approve_vendor_bill(*, bill, actor):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.approve")
    if bill.status == VendorBill.Status.APPROVED:
        return bill
    if bill.status != VendorBill.Status.PENDING:
        raise CodedValidationError(
            {"status": "Only pending vendor bills can be approved."},
            api_code="invalid_state_transition",
        )
    if bill.on_hold:
        raise CodedValidationError({"on_hold": "Release the hold before approving this bill."}, api_code="invalid_state_transition")
    bill.status = VendorBill.Status.APPROVED
    bill.approved_by = actor
    bill.approved_at = timezone.now()
    bill.save(update_fields=("status", "approved_by", "approved_at", "updated_at"))
    _notify_permission_holders(
        bill.institution,
        "vendor_bill.post",
        "Vendor bill posting required",
        f"Vendor bill {bill.bill_number} is approved and ready to post.",
        {"vendor_bill_id": str(bill.id)},
    )
    record_audit_event(
        actor=actor,
        institution=bill.institution,
        entity=bill,
        action="accounting.vendor_bill.approved",
        metadata=_transition("PENDING", "APPROVED"),
    )
    return bill


def _free_mapping_code(institution, mapping_code):
    """``mapping_code`` when no other account of the institution holds it yet."""
    if not mapping_code or Account.objects.filter(institution=institution, system_mapping_code=mapping_code).exists():
        return None
    return mapping_code


def _mapping_account(institution, mapping_code):
    """The institution's active, postable account for a system role (BQ-09).

    Resolved by ``Account.system_mapping_code`` (set from the applied preset or by
    the institution), never by account code or ID. Missing or unusable mapping
    fails closed.
    """
    account = Account.objects.filter(institution=institution, system_mapping_code=mapping_code).first()
    if account is None:
        raise CodedValidationError(
            {"account_mapping": f"No account is mapped to {mapping_code}. Map one in the chart of accounts."},
            api_code="policy_not_applicable",
        )
    if not (account.is_active and account.is_postable):
        raise CodedValidationError(
            {"account_mapping": f"Mapped account {mapping_code} ({account.code}) is inactive or not postable."},
            api_code="policy_not_applicable",
        )
    return account


def _vendor_bill_journal_lines(bill):
    lines = []
    component_totals = {}
    withholding_totals = {}
    for bill_line in bill.lines.select_related(
        "expense_account", "tax_code", "withholding_rule"
    ):
        lines.append(
            {
                "account": bill_line.expense_account,
                "description": bill_line.description,
                "debit": bill_line.line_total,
                "credit": Decimal("0"),
            }
        )
        for mapping_code, amount in _tax_component_amounts(bill_line).items():
            if not mapping_code:
                raise CodedValidationError(
                    {"tax_code": "Tax component lacks an input account mapping."},
                    api_code="policy_not_applicable",
                )
            component_totals[mapping_code] = component_totals.get(mapping_code, Decimal("0")) + amount
        if bill_line.withholding_rule_id:
            mapping_code = (
                "VAT_WITHHOLDING_PAYABLE"
                if bill_line.withholding_rule.is_vat_withholding_rule
                else "WITHHOLDING_TAX_PAYABLE"
            )
            withholding_totals[mapping_code] = withholding_totals.get(mapping_code, Decimal("0")) + _withholding_amount(bill_line)
    for mapping_code, amount in component_totals.items():
        lines.append({"account": _mapping_account(bill.institution, mapping_code), "description": f"{mapping_code} input", "debit": _money(amount), "credit": Decimal("0")})
    payables = _mapping_account(bill.institution, "TRADE_PAYABLES")
    lines.append({"account": payables, "description": f"Payable for {bill.bill_number}", "debit": Decimal("0"), "credit": bill.amount_payable})
    for mapping_code, amount in withholding_totals.items():
        lines.append({"account": _mapping_account(bill.institution, mapping_code), "description": f"{mapping_code} for {bill.bill_number}", "debit": Decimal("0"), "credit": _money(amount)})
    return lines


@transaction.atomic
def post_vendor_bill(*, bill, actor):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.post")
    if bill.status == VendorBill.Status.POSTED:
        return bill
    if bill.status != VendorBill.Status.APPROVED:
        raise CodedValidationError(
            {"status": "Only approved vendor bills can be posted."},
            api_code="invalid_state_transition",
        )
    if bill.on_hold:
        raise CodedValidationError({"on_hold": "Release the hold before posting this bill."}, api_code="invalid_state_transition")
    journal = _create_journal_record(
        institution=bill.institution,
        actor=actor,
        lines=_vendor_bill_journal_lines(bill),
        source=JournalEntry.Source.AP,
        accounting_period=bill.accounting_period,
        entry_date=bill.bill_date,
        description=f"Vendor bill {bill.bill_number}: {bill.vendor.name}",
        reference=f"AP-BILL-{bill.id}",
    )
    journal = submit_journal(journal=journal, actor=actor)
    journal = approve_journal(journal=journal, actor=actor, system=True, upstream_approver=bill.approved_by)
    journal = post_journal(journal=journal, actor=actor)
    bill.status = VendorBill.Status.POSTED
    bill.journal_entry = journal
    bill.save(update_fields=("status", "journal_entry", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=bill.institution,
        entity=bill,
        action="accounting.vendor_bill.posted",
        metadata=_transition("APPROVED", "POSTED", journal_entry_id=str(journal.id)),
    )
    return bill


@transaction.atomic
def void_vendor_bill(*, bill, actor):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.void")
    if bill.status == VendorBill.Status.VOID:
        return bill
    if bill.status in (VendorBill.Status.POSTED, VendorBill.Status.PART_PAID, VendorBill.Status.PAID):
        raise CodedValidationError(
            {"status": "Posted or paid bills require a future reversal/payment workflow."},
            api_code="record_immutable",
        )
    before = bill.status
    bill.status = VendorBill.Status.VOID
    bill.save(update_fields=("status", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=bill.institution,
        entity=bill,
        action="accounting.vendor_bill.voided",
        metadata=_transition(before, "VOID"),
    )
    return bill


@transaction.atomic
def create_customer(*, institution, actor, **values):
    _require(actor, institution, "customer.create")
    customer = Customer(institution=institution, **values)
    customer.save()
    record_audit_event(actor=actor, institution=institution, entity=customer, action="accounting.customer.created")
    return customer


@transaction.atomic
def update_customer(*, customer, actor, **values):
    customer = Customer.objects.select_for_update().get(pk=customer.pk)
    _require(actor, customer.institution, "customer.update")
    for field, value in values.items():
        setattr(customer, field, value)
    customer.save()
    record_audit_event(actor=actor, institution=customer.institution, entity=customer, action="accounting.customer.updated")
    return customer


def _refresh_invoice_totals(invoice):
    subtotal = Decimal("0")
    tax_total = Decimal("0")
    for line in invoice.lines.select_related("tax_code"):
        subtotal += line.line_total
        tax_total += sum(_tax_component_amounts(line).values(), Decimal("0"))
    invoice.subtotal = _money(subtotal)
    invoice.tax_total = _money(tax_total)
    invoice.total_amount = _money(invoice.subtotal + invoice.tax_total)
    invoice.save(update_fields=("subtotal", "tax_total", "total_amount", "updated_at"))
    return invoice


def _replace_invoice_lines(invoice, lines):
    invoice.lines.all().delete()
    for values in lines:
        line = InvoiceLine(invoice=invoice, **values)
        line.line_total = _line_total(values)
        line.save()
    return _refresh_invoice_totals(invoice)


@transaction.atomic
def create_invoice(*, institution, actor, lines, **values):
    _require(actor, institution, "invoice.create")
    values["customer"] = Customer.objects.select_for_update().get(pk=values["customer"].pk)
    values["accounting_period"] = AccountingPeriod.objects.select_for_update().get(
        pk=values["accounting_period"].pk
    )
    invoice = Invoice(institution=institution, **values)
    invoice.save()
    _replace_invoice_lines(invoice, lines)
    record_audit_event(actor=actor, institution=institution, entity=invoice, action="accounting.invoice.created")
    return invoice


@transaction.atomic
def update_draft_invoice(*, invoice, actor, lines=None, **values):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    _require(actor, invoice.institution, "invoice.create")
    if invoice.status != Invoice.Status.DRAFT:
        raise CodedValidationError({"status": "Only draft invoices can be edited."}, api_code="record_immutable")
    if "customer" in values:
        values["customer"] = Customer.objects.select_for_update().get(pk=values["customer"].pk)
    if "accounting_period" in values:
        values["accounting_period"] = AccountingPeriod.objects.select_for_update().get(pk=values["accounting_period"].pk)
    for field, value in values.items():
        setattr(invoice, field, value)
    invoice.save()
    if lines is not None:
        _replace_invoice_lines(invoice, lines)
    else:
        for line in invoice.lines.all():
            line.full_clean(validate_constraints=False)
        _refresh_invoice_totals(invoice)
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice, action="accounting.invoice.updated")
    return invoice


def _invoice_journal_lines(invoice):
    lines = []
    output_taxes = {}
    for invoice_line in invoice.lines.select_related("income_account", "tax_code"):
        lines.append({"account": invoice_line.income_account, "description": invoice_line.description, "debit": Decimal("0"), "credit": invoice_line.line_total})
        components = (
            TaxComponent.objects.filter(tax_code=invoice_line.tax_code).order_by("sequence", "code")
            if invoice_line.tax_code_id
            else ()
        )
        for component in components:
            if not component.output_account_mapping_code:
                raise CodedValidationError({"tax_code": "Tax component lacks an output account mapping."}, api_code="policy_not_applicable")
            output_taxes[component.output_account_mapping_code] = output_taxes.get(component.output_account_mapping_code, Decimal("0")) + _money(invoice_line.line_total * component.rate / Decimal("100"))
    lines.append({"account": _mapping_account(invoice.institution, "TRADE_RECEIVABLES"), "description": f"Receivable for {invoice.invoice_number}", "debit": invoice.total_amount, "credit": Decimal("0")})
    for mapping_code, amount in output_taxes.items():
        lines.append({"account": _mapping_account(invoice.institution, mapping_code), "description": f"{mapping_code} for {invoice.invoice_number}", "debit": Decimal("0"), "credit": _money(amount)})
    return lines


@transaction.atomic
def issue_invoice(*, invoice, actor):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    _require(actor, invoice.institution, "invoice.issue")
    if invoice.status == Invoice.Status.ISSUED:
        return invoice
    if invoice.status != Invoice.Status.DRAFT:
        raise CodedValidationError({"status": "Only draft invoices can be issued."}, api_code="invalid_state_transition")
    if not invoice.lines.exists():
        raise CodedValidationError({"lines": "An invoice requires at least one line."}, api_code="validation_error")
    _refresh_invoice_totals(invoice)
    journal = _create_journal_record(institution=invoice.institution, actor=actor, lines=_invoice_journal_lines(invoice), source=JournalEntry.Source.AR, accounting_period=invoice.accounting_period, entry_date=invoice.invoice_date, description=f"Invoice {invoice.invoice_number}: {invoice.customer.name}", reference=f"AR-INVOICE-{invoice.id}")
    journal = submit_journal(journal=journal, actor=actor)
    journal = approve_journal(journal=journal, actor=actor, system=True, upstream_approver=None)
    journal = post_journal(journal=journal, actor=actor)
    invoice.status = Invoice.Status.ISSUED
    invoice.journal_entry = journal
    invoice.save(update_fields=("status", "journal_entry", "updated_at"))
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice, action="accounting.invoice.issued", metadata=_transition("DRAFT", "ISSUED", journal_entry_id=str(journal.id)))
    return invoice


@transaction.atomic
def void_invoice(*, invoice, actor):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    _require(actor, invoice.institution, "invoice.void")
    if invoice.status == Invoice.Status.VOID:
        return invoice
    if invoice.status != Invoice.Status.DRAFT:
        raise CodedValidationError({"status": "Issued invoices require a future credit-note/reversal workflow."}, api_code="record_immutable")
    invoice.status = Invoice.Status.VOID
    invoice.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice, action="accounting.invoice.voided", metadata=_transition("DRAFT", "VOID"))
    return invoice


@transaction.atomic
def create_bank_account(*, institution, actor, **values):
    _require(actor, institution, "bank_account.create")
    values["ledger_account"] = Account.objects.select_for_update().get(
        pk=values["ledger_account"].pk
    )
    bank_account = BankAccount(institution=institution, **values)
    bank_account.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=bank_account,
        action="accounting.bank_account.created",
    )
    return bank_account


@transaction.atomic
def update_bank_account(*, bank_account, actor, **values):
    bank_account = BankAccount.objects.select_for_update().get(pk=bank_account.pk)
    _require(actor, bank_account.institution, "bank_account.update")
    if "ledger_account" in values:
        values["ledger_account"] = Account.objects.select_for_update().get(
            pk=values["ledger_account"].pk
        )
    before = {field: str(getattr(bank_account, field)) for field in values}
    for field, value in values.items():
        setattr(bank_account, field, value)
    bank_account.save()
    record_audit_event(
        actor=actor,
        institution=bank_account.institution,
        entity=bank_account,
        action="accounting.bank_account.updated",
        metadata={"before": before, "after": {field: str(getattr(bank_account, field)) for field in values}},
    )
    return bank_account


def _cash_transaction_period(*, institution, transaction_date, field_name):
    periods = list(
        AccountingPeriod.objects.select_for_update().filter(
            institution=institution,
            start_date__lte=transaction_date,
            end_date__gte=transaction_date,
        )
    )
    if len(periods) != 1:
        raise CodedValidationError(
            {field_name: "Transaction date must fall within exactly one accounting period."},
            api_code="validation_error",
        )
    period = periods[0]
    if period.status != AccountingPeriod.Status.OPEN:
        raise CodedValidationError(
            {field_name: "Closed or locked periods cannot accept cash transactions."},
            api_code="period_closed",
        )
    return period


def _cash_ledger_account(*, institution, bank_account):
    if bank_account is not None:
        if bank_account.institution_id != institution.id:
            raise CodedValidationError(
                {"bank_account": "Bank account belongs to another institution."},
                api_code="tenant_mismatch",
            )
        if not bank_account.is_active:
            raise CodedValidationError(
                {"bank_account": "Bank account is inactive."}, api_code="validation_error"
            )
        return bank_account.ledger_account
    return _mapping_account(institution, "CASH")


def _settled_amount(queryset):
    return _money(queryset.aggregate(total=Sum("amount"))["total"] or Decimal("0"))


def _sync_vendor_bill_settlement(*, bill, actor):
    settled = _settled_amount(
        Payment.objects.filter(vendor_bill=bill, status=Payment.Status.POSTED)
    )
    if settled > bill.amount_payable:
        raise CodedValidationError(
            {"amount": "Posted payments exceed the vendor bill payable amount."},
            api_code="validation_error",
        )
    next_status = (
        VendorBill.Status.PAID
        if settled == bill.amount_payable
        else VendorBill.Status.PART_PAID
        if settled > 0
        else VendorBill.Status.POSTED
    )
    if bill.status != next_status:
        before = bill.status
        VendorBill.objects.filter(pk=bill.pk).update(status=next_status, updated_at=timezone.now())
        bill.refresh_from_db()
        record_audit_event(
            actor=actor,
            institution=bill.institution,
            entity=bill,
            action="accounting.vendor_bill.settlement_updated",
            metadata=_transition(before, next_status, settled_amount=str(settled)),
        )
    return bill


def _sync_invoice_settlement(*, invoice, actor):
    settled = _settled_amount(
        Receipt.objects.filter(invoice=invoice, status=Receipt.Status.POSTED)
    )
    if settled > invoice.total_amount:
        raise CodedValidationError(
            {"amount": "Posted receipts exceed the invoice total amount."},
            api_code="validation_error",
        )
    next_status = (
        Invoice.Status.PAID
        if settled == invoice.total_amount
        else Invoice.Status.PART_PAID
        if settled > 0
        else Invoice.Status.ISSUED
    )
    if invoice.status != next_status:
        before = invoice.status
        Invoice.objects.filter(pk=invoice.pk).update(status=next_status, updated_at=timezone.now())
        invoice.refresh_from_db()
        record_audit_event(
            actor=actor,
            institution=invoice.institution,
            entity=invoice,
            action="accounting.invoice.settlement_updated",
            metadata=_transition(before, next_status, settled_amount=str(settled)),
        )
    return invoice


@transaction.atomic
def create_payment(*, institution, actor, **values):
    _require(actor, institution, "payment.create")
    if values.get("vendor_bill") is None:
        raise CodedValidationError(
            {"vendor_bill": "This MVP payment must settle one vendor bill."},
            api_code="validation_error",
        )
    bill = VendorBill.objects.select_for_update().get(pk=values["vendor_bill"].pk)
    bank_account = values.get("bank_account")
    if bank_account is not None:
        bank_account = BankAccount.objects.select_related("ledger_account").select_for_update().get(
            pk=bank_account.pk
        )
    if bill.institution_id != institution.id:
        raise CodedValidationError({"vendor_bill": "Vendor bill belongs to another institution."}, api_code="tenant_mismatch")
    if bill.status not in (VendorBill.Status.POSTED, VendorBill.Status.PART_PAID):
        raise CodedValidationError({"vendor_bill": "Only posted or part-paid vendor bills can be paid."}, api_code="invalid_state_transition")
    if values["currency"].upper() != bill.currency:
        raise CodedValidationError({"currency": "Payment currency must match the vendor bill."}, api_code="validation_error")
    settled = _settled_amount(Payment.objects.filter(vendor_bill=bill, status=Payment.Status.POSTED))
    amount = _money(values["amount"])
    if amount > bill.amount_payable - settled:
        raise CodedValidationError({"amount": "Payment exceeds the outstanding vendor bill amount."}, api_code="validation_error")
    period = _cash_transaction_period(
        institution=institution, transaction_date=values["payment_date"], field_name="payment_date"
    )
    values.update(
        vendor_bill=bill,
        bank_account=bank_account,
        amount=amount,
        status=Payment.Status.POSTED,
    )
    payment = Payment(institution=institution, **values)
    payment.save()
    cash_account = _cash_ledger_account(institution=institution, bank_account=bank_account)
    journal = _create_journal_record(
        institution=institution,
        actor=actor,
        source=JournalEntry.Source.CASH,
        accounting_period=period,
        entry_date=payment.payment_date,
        description=f"Payment {payment.payment_number} for vendor bill {bill.bill_number}",
        reference=f"PAYMENT-{payment.id}",
        lines=[
            {"account": _mapping_account(institution, "TRADE_PAYABLES"), "description": f"Settle {bill.bill_number}", "debit": amount, "credit": Decimal("0")},
            {"account": cash_account, "description": f"Payment {payment.payment_number}", "debit": Decimal("0"), "credit": amount},
        ],
    )
    journal = submit_journal(journal=journal, actor=actor)
    journal = approve_journal(journal=journal, actor=actor, system=True, upstream_approver=None)
    journal = post_journal(journal=journal, actor=actor)
    Payment.objects.filter(pk=payment.pk).update(journal_entry=journal, updated_at=timezone.now())
    payment.refresh_from_db()
    _sync_vendor_bill_settlement(bill=bill, actor=actor)
    record_audit_event(
        actor=actor, institution=institution, entity=payment, action="accounting.payment.posted",
        metadata={"vendor_bill_id": str(bill.id), "journal_entry_id": str(journal.id), "amount": str(amount)},
    )
    return payment


@transaction.atomic
def create_receipt(*, institution, actor, **values):
    _require(actor, institution, "receipt.create")
    if values.get("invoice") is None:
        raise CodedValidationError(
            {"invoice": "This MVP receipt must settle one invoice."}, api_code="validation_error"
        )
    invoice = Invoice.objects.select_for_update().get(pk=values["invoice"].pk)
    bank_account = values.get("bank_account")
    if bank_account is not None:
        bank_account = BankAccount.objects.select_related("ledger_account").select_for_update().get(
            pk=bank_account.pk
        )
    if invoice.institution_id != institution.id:
        raise CodedValidationError({"invoice": "Invoice belongs to another institution."}, api_code="tenant_mismatch")
    if invoice.status not in (Invoice.Status.ISSUED, Invoice.Status.PART_PAID):
        raise CodedValidationError({"invoice": "Only issued or part-paid invoices can receive receipts."}, api_code="invalid_state_transition")
    if values["currency"].upper() != invoice.currency:
        raise CodedValidationError({"currency": "Receipt currency must match the invoice."}, api_code="validation_error")
    settled = _settled_amount(Receipt.objects.filter(invoice=invoice, status=Receipt.Status.POSTED))
    amount = _money(values["amount"])
    if amount > invoice.total_amount - settled:
        raise CodedValidationError({"amount": "Receipt exceeds the outstanding invoice amount."}, api_code="validation_error")
    period = _cash_transaction_period(
        institution=institution, transaction_date=values["receipt_date"], field_name="receipt_date"
    )
    values.update(
        invoice=invoice,
        bank_account=bank_account,
        amount=amount,
        status=Receipt.Status.POSTED,
    )
    receipt = Receipt(institution=institution, **values)
    receipt.save()
    cash_account = _cash_ledger_account(institution=institution, bank_account=bank_account)
    journal = _create_journal_record(
        institution=institution,
        actor=actor,
        source=JournalEntry.Source.CASH,
        accounting_period=period,
        entry_date=receipt.receipt_date,
        description=f"Receipt {receipt.receipt_number} for invoice {invoice.invoice_number}",
        reference=f"RECEIPT-{receipt.id}",
        lines=[
            {"account": cash_account, "description": f"Receipt {receipt.receipt_number}", "debit": amount, "credit": Decimal("0")},
            {"account": _mapping_account(institution, "TRADE_RECEIVABLES"), "description": f"Settle {invoice.invoice_number}", "debit": Decimal("0"), "credit": amount},
        ],
    )
    journal = submit_journal(journal=journal, actor=actor)
    journal = approve_journal(journal=journal, actor=actor, system=True, upstream_approver=None)
    journal = post_journal(journal=journal, actor=actor)
    Receipt.objects.filter(pk=receipt.pk).update(journal_entry=journal, updated_at=timezone.now())
    receipt.refresh_from_db()
    _sync_invoice_settlement(invoice=invoice, actor=actor)
    record_audit_event(
        actor=actor, institution=institution, entity=receipt, action="accounting.receipt.posted",
        metadata={"invoice_id": str(invoice.id), "journal_entry_id": str(journal.id), "amount": str(amount)},
    )
    return receipt


def _void_cash_transaction(*, transaction_record, actor, void_date, period, action, target, sync):
    if transaction_record.status == transaction_record.Status.VOID:
        return transaction_record
    _require(actor, transaction_record.institution, action)
    if transaction_record.status != transaction_record.Status.POSTED or not transaction_record.journal_entry_id:
        raise CodedValidationError({"status": "Only posted cash transactions can be voided."}, api_code="invalid_state_transition")
    if transaction_record.journal_entry.status != JournalEntry.Status.POSTED:
        raise CodedValidationError(
            {"journal_entry": "Cash transaction journal has already been reversed or is not posted."},
            api_code="record_immutable",
        )
    reversal = create_reversal(
        journal=transaction_record.journal_entry,
        actor=actor,
        entry_date=void_date,
        accounting_period=period,
        description=f"Void {transaction_record._meta.verbose_name} {transaction_record.pk}",
    )
    reversal = submit_journal(journal=reversal, actor=actor)
    reversal = approve_journal(journal=reversal, actor=actor, system=True, upstream_approver=None)
    post_journal(journal=reversal, actor=actor)
    transaction_record.__class__.objects.filter(pk=transaction_record.pk).update(status=transaction_record.Status.VOID, updated_at=timezone.now())
    transaction_record.refresh_from_db()
    sync_argument = "bill" if target == "vendor_bill" else "invoice"
    sync(**{sync_argument: getattr(transaction_record, target), "actor": actor})
    record_audit_event(actor=actor, institution=transaction_record.institution, entity=transaction_record, action=f"accounting.{transaction_record._meta.model_name}.voided", metadata={"reversal_journal_id": str(reversal.id)})
    return transaction_record


@transaction.atomic
def void_payment(*, payment, actor, void_date):
    payment = Payment.objects.select_related("journal_entry", "vendor_bill").select_for_update(of=("self",)).get(pk=payment.pk)
    payment.vendor_bill = VendorBill.objects.select_for_update().get(pk=payment.vendor_bill_id)
    period = _cash_transaction_period(institution=payment.institution, transaction_date=void_date, field_name="void_date")
    return _void_cash_transaction(transaction_record=payment, actor=actor, void_date=void_date, period=period, action="payment.void", target="vendor_bill", sync=_sync_vendor_bill_settlement)


@transaction.atomic
def void_receipt(*, receipt, actor, void_date):
    receipt = Receipt.objects.select_related("journal_entry", "invoice").select_for_update(of=("self",)).get(pk=receipt.pk)
    receipt.invoice = Invoice.objects.select_for_update().get(pk=receipt.invoice_id)
    period = _cash_transaction_period(institution=receipt.institution, transaction_date=void_date, field_name="void_date")
    return _void_cash_transaction(transaction_record=receipt, actor=actor, void_date=void_date, period=period, action="receipt.void", target="invoice", sync=_sync_invoice_settlement)


@transaction.atomic
def create_bank_statement_line(*, institution, actor, **values):
    _require(actor, institution, "bank_reconciliation.manage")
    external_id = values["external_id"].strip().upper()
    bank_account = BankAccount.objects.select_for_update().get(pk=values["bank_account"].pk)
    existing = BankStatementLine.objects.select_for_update().filter(
        bank_account=bank_account, external_id=external_id
    ).first()
    if existing:
        same_payload = (
            existing.statement_date == values["statement_date"]
            and existing.reference == values.get("reference", "")
            and existing.description == values.get("description", "")
            and existing.amount == Decimal(values["amount"])
            and existing.currency == values["currency"].strip().upper()
        )
        if not same_payload:
            raise CodedValidationError({"external_id": "Existing statement line conflicts with this import."}, api_code="duplicate_operation")
        return existing
    values["bank_account"] = bank_account
    line = BankStatementLine(institution=institution, **values)
    line.save()
    record_audit_event(actor=actor, institution=institution, entity=line, action="accounting.bank_statement_line.imported", metadata={"external_id": line.external_id, "amount": str(line.amount)})
    return line


def _bank_journal_movement(*, journal, bank_account):
    totals = journal.lines.filter(account=bank_account.ledger_account).aggregate(
        debit=Sum("debit"), credit=Sum("credit")
    )
    return _money((totals["debit"] or Decimal("0")) - (totals["credit"] or Decimal("0")))


@transaction.atomic
def match_bank_statement_line(*, statement_line, journal, actor):
    line = BankStatementLine.objects.select_for_update().select_related("bank_account").get(pk=statement_line.pk)
    _require(actor, line.institution, "bank_reconciliation.manage")
    if line.status == BankStatementLine.Status.MATCHED:
        if line.journal_entry_id == journal.id:
            return line
        raise CodedValidationError({"status": "Statement line is already matched."}, api_code="invalid_state_transition")
    target = JournalEntry.objects.select_for_update().get(pk=journal.pk)
    if target.institution_id != line.institution_id:
        raise CodedValidationError({"journal_entry": "Journal belongs to another institution."}, api_code="tenant_mismatch")
    if target.status != JournalEntry.Status.POSTED:
        raise CodedValidationError({"journal_entry": "Only posted journals can be reconciled."}, api_code="invalid_state_transition")
    if BankStatementLine.objects.filter(journal_entry=target).exists():
        raise CodedValidationError({"journal_entry": "Journal is already matched to another statement line."}, api_code="duplicate_operation")
    if _bank_journal_movement(journal=target, bank_account=line.bank_account) != line.amount:
        raise CodedValidationError({"journal_entry": "Bank-ledger movement does not equal the statement amount."}, api_code="validation_error")
    line.journal_entry, line.status = target, BankStatementLine.Status.MATCHED
    line.reconciled_by, line.reconciled_at = actor, timezone.now()
    line.save()
    record_audit_event(actor=actor, institution=line.institution, entity=line, action="accounting.bank_statement_line.matched", metadata={"journal_entry_id": str(target.id), "amount": str(line.amount)})
    return line


@transaction.atomic
def unmatch_bank_statement_line(*, statement_line, actor):
    line = BankStatementLine.objects.select_for_update().get(pk=statement_line.pk)
    _require(actor, line.institution, "bank_reconciliation.manage")
    if line.status == BankStatementLine.Status.UNMATCHED:
        return line
    if line.status != BankStatementLine.Status.MATCHED:
        raise CodedValidationError({"status": "Only matched statement lines can be unmatched."}, api_code="invalid_state_transition")
    journal_id = line.journal_entry_id
    line.journal_entry = None
    line.status = BankStatementLine.Status.UNMATCHED
    line.reconciled_by = None
    line.reconciled_at = None
    line.save()
    record_audit_event(actor=actor, institution=line.institution, entity=line, action="accounting.bank_statement_line.unmatched", metadata={"journal_entry_id": str(journal_id)})
    return line


@transaction.atomic
def issue_vat_withholding_certificate(*, institution, actor, **values):
    _require(actor, institution, "vat_withholding_certificate.issue")
    configuration = InstitutionAccountingConfiguration.objects.select_for_update().get(institution=institution)
    if not configuration.is_vat_withholding_agent:
        raise CodedValidationError({"institution": "Institution is not configured as a VAT withholding agent."}, api_code="policy_not_applicable")
    bill = VendorBill.objects.select_for_update().get(pk=values["vendor_bill"].pk)
    rule = WithholdingRule.objects.get(pk=values["withholding_rule"].pk)
    if bill.status not in (VendorBill.Status.POSTED, VendorBill.Status.PART_PAID, VendorBill.Status.PAID):
        raise CodedValidationError({"vendor_bill": "Only posted vendor bills can receive a certificate."}, api_code="invalid_state_transition")
    if bill.institution_id != institution.id or rule.preset_version_id != configuration.selected_accounting_preset_version_id:
        raise CodedValidationError({"vendor_bill": "Certificate references must match the active institution preset."}, api_code="tenant_mismatch")
    if not rule.is_vat_withholding_rule:
        raise CodedValidationError({"withholding_rule": "Certificate requires a VAT withholding rule."}, api_code="policy_not_applicable")
    values["vendor_bill"] = bill
    values["withholding_rule"] = rule
    certificate = VATWithholdingCertificate(institution=institution, issued_by=actor, issued_at=timezone.now(), status=VATWithholdingCertificate.Status.ISSUED, **values)
    certificate.full_clean()
    certificate.save()
    record_audit_event(actor=actor, institution=institution, entity=certificate, action="accounting.vat_withholding_certificate.issued", metadata={"vendor_bill_id": str(bill.id), "amount": str(certificate.amount)})
    return certificate


@transaction.atomic
def void_vat_withholding_certificate(*, certificate, actor):
    certificate = VATWithholdingCertificate.objects.select_for_update().get(pk=certificate.pk)
    _require(actor, certificate.institution, "vat_withholding_certificate.issue")
    if certificate.status == VATWithholdingCertificate.Status.VOID:
        return certificate
    if certificate.status != VATWithholdingCertificate.Status.ISSUED:
        raise CodedValidationError({"status": "Only issued certificates can be voided."}, api_code="invalid_state_transition")
    certificate.status = VATWithholdingCertificate.Status.VOID
    certificate.voided_by, certificate.voided_at = actor, timezone.now()
    certificate.save(update_fields=("status", "voided_by", "voided_at", "updated_at"))
    record_audit_event(actor=actor, institution=certificate.institution, entity=certificate, action="accounting.vat_withholding_certificate.voided")
    return certificate


# Expense Management 2.0 lives in apps/accounting/expenses.py (Wave 6).
from apps.accounting.expenses import (  # noqa: E402,F401
    approve_expense,
    create_expense,
    decide_expense_step,
    finance_review_expense,
    policy_checks as expense_policy_checks,
    post_expense,
    reject_expense,
    reverse_expense,
    settle_expense,
    submit_expense,
    update_draft_expense,
)


@transaction.atomic
def apply_payroll_account_mapping_templates(*, institution, actor, effective_from):
    _require(actor, institution, "payroll_accounting.configure")
    configuration = InstitutionAccountingConfiguration.objects.select_for_update().filter(institution=institution).first()
    version = getattr(configuration, "selected_accounting_preset_version", None)
    if version is None:
        raise CodedValidationError({"accounting_configuration": "An applied accounting preset is required."}, api_code="policy_not_applicable")
    created = []
    for template in PayrollAccountMappingTemplate.objects.filter(accounting_preset_version=version):
        component = PayComponent.objects.filter(institution=institution, code=template.payroll_component_code, is_active=True).first()
        if component is None:
            continue
        debit = _mapping_account(institution, template.debit_account_mapping_code) if template.debit_account_mapping_code else None
        credit = _mapping_account(institution, template.credit_account_mapping_code) if template.credit_account_mapping_code else None
        mapping, was_created = PayComponentAccountMapping.objects.get_or_create(institution=institution, pay_component=component, effective_from=effective_from, defaults={"debit_account": debit, "credit_account": credit, "is_active": True})
        if not was_created and (mapping.debit_account_id != getattr(debit, "id", None) or mapping.credit_account_id != getattr(credit, "id", None)):
            raise CodedValidationError({"pay_component": f"Existing mapping conflicts for {component.code}."}, api_code="duplicate_operation")
        if was_created: created.append(mapping)
    record_audit_event(actor=actor, institution=institution, entity=configuration, action="accounting.payroll_mappings.applied", metadata={"effective_from": str(effective_from), "created_count": len(created)})
    return created


@transaction.atomic
def generate_payroll_journal(*, payroll_run, actor):
    run = PayrollRun.objects.select_for_update().select_related("payroll_period").get(pk=payroll_run.pk)
    if not InstitutionModule.objects.filter(
        institution=run.institution,
        module_code=InstitutionModule.ModuleCode.ACCOUNTING,
        is_enabled=True,
    ).exists():
        raise CodedValidationError(
            {"module": "The ACCOUNTING module is disabled."}, api_code="module_disabled"
        )
    _require(actor, run.institution, "journal.create")
    if run.status != PayrollRun.Status.FINALIZED:
        raise CodedValidationError({"status": "Only finalized payroll runs can generate journals."}, api_code="invalid_state_transition")
    if run.accounting_journal_entry_id:
        return run.accounting_journal_entry
    period = _cash_transaction_period(institution=run.institution, transaction_date=run.payroll_period.pay_date, field_name="pay_date")
    totals = {}
    items = run.records.prefetch_related("items__pay_component").all()
    for record in items:
        for item in record.items.all():
            mapping = None
            if item.pay_component_id:
                mapping = PayComponentAccountMapping.objects.filter(institution=run.institution, pay_component=item.pay_component, is_active=True, effective_from__lte=run.payroll_period.pay_date).filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=run.payroll_period.pay_date)).order_by("-effective_from").first()
            if mapping and mapping.debit_account_id and mapping.credit_account_id:
                debit_account, credit_account = mapping.debit_account, mapping.credit_account
            else:
                configuration = InstitutionAccountingConfiguration.objects.filter(institution=run.institution).only("selected_accounting_preset_version_id").first()
                template = PayrollAccountMappingTemplate.objects.filter(accounting_preset_version_id=getattr(configuration, "selected_accounting_preset_version_id", None), payroll_component_code=item.component_code_snapshot).first()
                if not template or not template.debit_account_mapping_code or not template.credit_account_mapping_code:
                    raise CodedValidationError({"pay_component": f"Complete effective debit/credit mapping required for {item.component_code_snapshot}."}, api_code="policy_not_applicable")
                debit_account = _mapping_account(run.institution, template.debit_account_mapping_code)
                credit_account = _mapping_account(run.institution, template.credit_account_mapping_code)
            if not debit_account or not credit_account:
                raise CodedValidationError({"pay_component": f"Complete effective debit/credit mapping required for {item.component_code_snapshot}."}, api_code="policy_not_applicable")
            totals[debit_account] = totals.get(debit_account, [Decimal("0"), Decimal("0")]); totals[debit_account][0] += item.amount
            totals[credit_account] = totals.get(credit_account, [Decimal("0"), Decimal("0")]); totals[credit_account][1] += item.amount
    lines = []
    for account, amounts in totals.items():
        debit, credit = (_money(amounts[0]), _money(amounts[1]))
        if debit == credit:
            continue
        lines.append(
            {
                "account": account,
                "description": f"Payroll {run.payroll_period.name}",
                "debit": debit - credit if debit > credit else Decimal("0"),
                "credit": credit - debit if credit > debit else Decimal("0"),
            }
        )
    if not lines: raise CodedValidationError({"payroll_run": "No mapped payroll items are available."}, api_code="validation_error")
    journal = _create_journal_record(institution=run.institution, actor=actor, lines=lines, source=JournalEntry.Source.PAYROLL, accounting_period=period, entry_date=run.payroll_period.pay_date, description=f"Payroll {run.payroll_period.name}", reference=f"PAYROLL-{run.id}")
    PayrollRun.objects.filter(pk=run.pk).update(accounting_journal_entry=journal, updated_at=timezone.now())
    record_audit_event(actor=actor, institution=run.institution, entity=run, action="accounting.payroll_journal.generated", metadata={"journal_entry_id": str(journal.id)})
    return journal


# --- Accounts payable workflow extras (concept "Accounts payable") -------------

@transaction.atomic
def reject_vendor_bill(*, bill, actor, reason):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.approve")
    if bill.status != VendorBill.Status.PENDING:
        raise CodedValidationError({"status": "Only pending vendor bills can be rejected."}, api_code="invalid_state_transition")
    if not (reason or "").strip():
        raise CodedValidationError({"reason": "Explain why the bill is rejected."}, api_code="validation_error")
    bill.status = VendorBill.Status.REJECTED
    bill.rejected_by = actor
    bill.rejected_at = timezone.now()
    bill.rejection_reason = reason.strip()
    bill.save(update_fields=("status", "rejected_by", "rejected_at", "rejection_reason", "updated_at"))
    record_audit_event(actor=actor, institution=bill.institution, entity=bill, action="accounting.vendor_bill.rejected",
                       metadata=_transition("PENDING", "REJECTED", reason=bill.rejection_reason))
    return bill


@transaction.atomic
def revise_vendor_bill(*, bill, actor):
    """Return a rejected bill to draft so it can be corrected and resubmitted."""
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.create")
    if bill.status != VendorBill.Status.REJECTED:
        raise CodedValidationError({"status": "Only rejected bills can be revised."}, api_code="invalid_state_transition")
    bill.status = VendorBill.Status.DRAFT
    bill.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=bill.institution, entity=bill, action="accounting.vendor_bill.revised", metadata=_transition("REJECTED", "DRAFT"))
    return bill


@transaction.atomic
def set_vendor_bill_hold(*, bill, actor, on_hold, reason=""):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "vendor_bill.approve")
    if bill.status in (VendorBill.Status.PAID, VendorBill.Status.VOID):
        raise CodedValidationError({"status": "Paid or void bills cannot be held."}, api_code="invalid_state_transition")
    if on_hold and not (reason or "").strip():
        raise CodedValidationError({"reason": "Give a reason for the hold."}, api_code="validation_error")
    bill.on_hold = on_hold
    bill.hold_reason = reason.strip() if on_hold else ""
    bill.save(update_fields=("on_hold", "hold_reason", "updated_at"))
    record_audit_event(actor=actor, institution=bill.institution, entity=bill,
                       action="accounting.vendor_bill.held" if on_hold else "accounting.vendor_bill.released", metadata={"reason": bill.hold_reason})
    return bill


@transaction.atomic
def schedule_vendor_bill_payment(*, bill, actor, payment_date, payment_method):
    bill = VendorBill.objects.select_for_update().get(pk=bill.pk)
    _require(actor, bill.institution, "payment.create")
    if bill.status not in (VendorBill.Status.POSTED, VendorBill.Status.PART_PAID):
        raise CodedValidationError({"status": "Only posted, unpaid bills can be scheduled for payment."}, api_code="invalid_state_transition")
    if bill.on_hold:
        raise CodedValidationError({"on_hold": "Release the hold before scheduling payment."}, api_code="invalid_state_transition")
    if payment_method not in Payment.Method.values:
        raise CodedValidationError({"payment_method": "Choose a valid payment method."}, api_code="validation_error")
    bill.scheduled_payment_date = payment_date
    bill.scheduled_payment_method = payment_method
    bill.save(update_fields=("scheduled_payment_date", "scheduled_payment_method", "updated_at"))
    record_audit_event(actor=actor, institution=bill.institution, entity=bill, action="accounting.vendor_bill.payment_scheduled",
                       metadata={"payment_date": payment_date.isoformat(), "payment_method": payment_method})
    return bill


# --- Accounts receivable collections (concept "Accounts receivable") ----------

def invoice_amount_received(invoice):
    from django.db.models import Sum

    return Decimal(Receipt.objects.filter(invoice=invoice, status=Receipt.Status.POSTED).aggregate(total=Sum("amount"))["total"] or 0).quantize(Decimal("0.01"))


@transaction.atomic
def set_invoice_hold(*, invoice, actor, on_hold, reason=""):
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    _require(actor, invoice.institution, "invoice.issue")
    if invoice.status in (Invoice.Status.PAID, Invoice.Status.VOID):
        raise CodedValidationError({"status": "Paid or void invoices cannot be held."}, api_code="invalid_state_transition")
    if on_hold and not (reason or "").strip():
        raise CodedValidationError({"reason": "Give a reason, such as the customer's dispute."}, api_code="validation_error")
    invoice.on_hold = on_hold
    invoice.hold_reason = reason.strip() if on_hold else ""
    invoice.save(update_fields=("on_hold", "hold_reason", "updated_at"))
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice,
                       action="accounting.invoice.held" if on_hold else "accounting.invoice.released", metadata={"reason": invoice.hold_reason})
    return invoice


@transaction.atomic
def send_invoice(*, invoice, actor, email=""):
    """Issue a draft (posting its AR journal) and email it to the customer."""
    from django.conf import settings as django_settings
    from django.core.mail import send_mail

    if invoice.status == Invoice.Status.DRAFT:
        invoice = issue_invoice(invoice=invoice, actor=actor)
    invoice = Invoice.objects.select_for_update().select_related("customer", "institution").get(pk=invoice.pk)
    _require(actor, invoice.institution, "invoice.issue")
    if invoice.status == Invoice.Status.VOID:
        raise CodedValidationError({"status": "Void invoices cannot be sent."}, api_code="invalid_state_transition")
    recipient = (email or invoice.customer.email or "").strip()
    if not recipient:
        raise CodedValidationError({"email": "Add the customer's email address to send the invoice."}, api_code="validation_error")
    lines = "\n".join(f"- {line.description}: {invoice.currency} {line.line_total:,.2f}" for line in invoice.lines.all())
    body = (
        f"Dear {invoice.customer.name},\n\nPlease find invoice {invoice.invoice_number} from {invoice.institution.name}.\n\n{lines}\n\n"
        f"Total due: {invoice.currency} {invoice.total_amount:,.2f}\nDue date: {invoice.due_date:%d %B %Y}\n\nThank you."
    )
    delivery = "SENT"
    if not getattr(django_settings, "EMAIL_HOST", "") and "smtp" in getattr(django_settings, "EMAIL_BACKEND", "smtp"):
        delivery = "NOT_CONFIGURED"
    else:
        try:
            send_mail(f"Invoice {invoice.invoice_number} from {invoice.institution.name}", body, django_settings.DEFAULT_FROM_EMAIL, [recipient], fail_silently=False)
        except Exception:  # noqa: BLE001 - delivery failure is recorded, not fatal
            delivery = "FAILED"
    if delivery == "SENT":
        invoice.sent_at = timezone.now()
        invoice.sent_to = recipient
        invoice.save(update_fields=("sent_at", "sent_to", "updated_at"))
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice, action="accounting.invoice.sent", metadata={"to": recipient, "delivery": delivery})
    return invoice, delivery


@transaction.atomic
def add_invoice_reminder(*, invoice, actor, remind_on, channel, note=""):
    from apps.accounting.models import InvoiceReminder

    _require(actor, invoice.institution, "invoice.issue")
    if invoice.status not in (Invoice.Status.ISSUED, Invoice.Status.PART_PAID):
        raise CodedValidationError({"status": "Reminders apply to issued, unpaid invoices."}, api_code="invalid_state_transition")
    reminder = InvoiceReminder(institution=invoice.institution, invoice=invoice, remind_on=remind_on, channel=channel, note=(note or "").strip(), created_by=actor)
    reminder.full_clean()
    reminder.save()
    record_audit_event(actor=actor, institution=invoice.institution, entity=invoice, action="accounting.invoice.reminder_added", metadata={"remind_on": remind_on.isoformat(), "channel": channel})
    return reminder


@transaction.atomic
def update_invoice_reminder(*, reminder, actor, status):
    from apps.accounting.models import InvoiceReminder

    _require(actor, reminder.institution, "invoice.issue")
    if status not in (InvoiceReminder.Status.DONE, InvoiceReminder.Status.CANCELLED) or reminder.status != InvoiceReminder.Status.SCHEDULED:
        raise CodedValidationError({"status": "Only scheduled reminders can be completed or cancelled."}, api_code="invalid_state_transition")
    reminder.status = status
    reminder.completed_at = timezone.now()
    reminder.save(update_fields=("status", "completed_at", "updated_at"))
    record_audit_event(actor=actor, institution=reminder.institution, entity=reminder.invoice, action=f"accounting.invoice.reminder_{status.lower()}")
    return reminder


# --- Bank reconciliation sessions (concept "Bank reconciliation") ------------

def _session_lines(session):
    return BankStatementLine.objects.filter(
        bank_account=session.bank_account, statement_date__gte=session.period_start, statement_date__lte=session.period_end,
    )


def bank_book_balance(*, bank_account, as_of):
    totals = JournalLine.objects.filter(
        account=bank_account.ledger_account, journal_entry__status__in=(JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED),
        journal_entry__entry_date__lte=as_of,
    ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
    return _money(Decimal(totals["debit"] or 0) - Decimal(totals["credit"] or 0))


def suggested_journals(*, statement_line, window_days=7, limit=5):
    """Posted journals whose bank-ledger movement equals the statement amount,
    dated near the statement date and not already matched."""
    from datetime import timedelta

    bank_account = statement_line.bank_account
    candidates = JournalEntry.objects.filter(
        institution=statement_line.institution, status=JournalEntry.Status.POSTED,
        entry_date__gte=statement_line.statement_date - timedelta(days=window_days),
        entry_date__lte=statement_line.statement_date + timedelta(days=window_days),
        lines__account=bank_account.ledger_account, bank_statement_match__isnull=True,
    ).distinct().order_by("entry_date")
    matches = []
    for journal in candidates[:50]:
        if _bank_journal_movement(journal=journal, bank_account=bank_account) == statement_line.amount:
            matches.append(journal)
            if len(matches) >= limit:
                break
    return matches


@transaction.atomic
def start_reconciliation_session(*, institution, actor, bank_account, period_start, period_end, statement_opening_balance=None, statement_closing_balance=None):
    from apps.accounting.models import BankReconciliationSession

    _require(actor, institution, "bank_reconciliation.manage")
    session = BankReconciliationSession.objects.filter(bank_account=bank_account, period_start=period_start, period_end=period_end).first()
    if session:
        return session
    session = BankReconciliationSession(
        institution=institution, bank_account=bank_account, period_start=period_start, period_end=period_end,
        statement_opening_balance=statement_opening_balance, statement_closing_balance=statement_closing_balance, started_by=actor,
    )
    session.full_clean()
    session.save()
    record_audit_event(actor=actor, institution=institution, entity=session, action="accounting.reconciliation.started",
                       metadata={"bank_account_id": str(bank_account.id), "period_start": period_start.isoformat(), "period_end": period_end.isoformat()})
    return session


@transaction.atomic
def update_reconciliation_balances(*, session, actor, statement_opening_balance=None, statement_closing_balance=None):
    from apps.accounting.models import BankReconciliationSession

    session = BankReconciliationSession.objects.select_for_update().get(pk=session.pk)
    _require(actor, session.institution, "bank_reconciliation.manage")
    if session.status == BankReconciliationSession.Status.COMPLETED:
        raise CodedValidationError({"status": "Reopen is not supported; completed reconciliations are final."}, api_code="record_immutable")
    session.statement_opening_balance = statement_opening_balance
    session.statement_closing_balance = statement_closing_balance
    session.save(update_fields=("statement_opening_balance", "statement_closing_balance", "updated_at"))
    return session


def reconciliation_overview(session):
    lines = list(_session_lines(session).order_by("statement_date", "created_at"))
    matched = [line for line in lines if line.status == BankStatementLine.Status.MATCHED]
    unmatched = [line for line in lines if line.status == BankStatementLine.Status.UNMATCHED]
    exceptions = [line for line in lines if line.status == BankStatementLine.Status.EXCEPTION]
    book = bank_book_balance(bank_account=session.bank_account, as_of=session.period_end)
    difference = None
    if session.statement_closing_balance is not None:
        # Reconciled when the statement closing balance equals the posted bank-ledger balance.
        difference = _money(session.statement_closing_balance - book)
    total = len(lines)
    return {
        "lines": lines,
        "counts": {"all": total, "matched": len(matched), "unmatched": len(unmatched), "exceptions": len(exceptions)},
        "matched_amount": _money(sum((abs(line.amount) for line in matched), Decimal("0"))),
        "unmatched_amount": _money(sum((abs(line.amount) for line in unmatched + exceptions), Decimal("0"))),
        "progress": round(len(matched) * 100 / total) if total else 0,
        "book_balance": book,
        "difference": difference,
        "can_complete": session.status != "COMPLETED" and total > 0 and not unmatched and difference == Decimal("0.00"),
    }


@transaction.atomic
def complete_reconciliation_session(*, session, actor):
    from apps.accounting.models import BankReconciliationSession

    session = BankReconciliationSession.objects.select_for_update().get(pk=session.pk)
    _require(actor, session.institution, "bank_reconciliation.manage")
    if session.status == BankReconciliationSession.Status.COMPLETED:
        return session
    overview = reconciliation_overview(session)
    if not overview["counts"]["all"]:
        raise CodedValidationError({"lines": "Import the statement before completing the reconciliation."}, api_code="validation_error")
    if overview["counts"]["unmatched"]:
        raise CodedValidationError({"lines": "Match every statement line or flag it as an exception first."}, api_code="validation_error")
    if overview["difference"] is None:
        raise CodedValidationError({"statement_closing_balance": "Enter the statement closing balance."}, api_code="validation_error")
    if overview["difference"] != Decimal("0.00"):
        raise CodedValidationError({"difference": f"The statement and books differ by {overview['difference']}."}, api_code="validation_error")
    session.status = BankReconciliationSession.Status.COMPLETED
    session.completed_by = actor
    session.completed_at = timezone.now()
    session.save(update_fields=("status", "completed_by", "completed_at", "updated_at"))
    record_audit_event(actor=actor, institution=session.institution, entity=session, action="accounting.reconciliation.completed",
                       metadata={"matched": overview["counts"]["matched"], "exceptions": overview["counts"]["exceptions"]})
    return session


@transaction.atomic
def import_statement_csv(*, session, actor, content):
    """Import statement lines from CSV with headers date, description, reference, amount[, external_id]."""
    import csv
    import io
    from datetime import date as date_type

    _require(actor, session.institution, "bank_reconciliation.manage")
    reader = csv.DictReader(io.StringIO(content))
    headers = {(name or "").strip().lower() for name in (reader.fieldnames or [])}
    if not {"date", "amount"} <= headers:
        raise CodedValidationError({"file": "The CSV needs at least 'date' and 'amount' columns."}, api_code="validation_error")
    created, skipped, errors = 0, 0, []
    for index, raw in enumerate(reader, start=2):
        row = {(key or "").strip().lower(): (value or "").strip() for key, value in raw.items()}
        try:
            statement_date = date_type.fromisoformat(row["date"])
            amount = Decimal(row["amount"].replace(",", ""))
        except Exception:  # noqa: BLE001 - reported per row
            errors.append(f"Row {index}: use YYYY-MM-DD dates and numeric amounts.")
            continue
        if amount == 0:
            errors.append(f"Row {index}: amount cannot be zero.")
            continue
        external_id = row.get("external_id") or f"{statement_date:%Y%m%d}-{row.get('reference') or index}-{amount}"
        before = BankStatementLine.objects.filter(bank_account=session.bank_account, external_id=external_id.strip().upper()).exists()
        try:
            create_bank_statement_line(
                institution=session.institution, actor=actor, bank_account=session.bank_account, statement_date=statement_date,
                external_id=external_id, reference=row.get("reference", "")[:150], description=row.get("description", ""),
                amount=amount, currency=session.bank_account.currency,
            )
        except ValidationError as exc:
            errors.append(f"Row {index}: {'; '.join(exc.messages)}")
            continue
        if before:
            skipped += 1
        else:
            created += 1
    from apps.accounting.models import BankReconciliationSession

    BankReconciliationSession.objects.filter(pk=session.pk).update(last_imported_at=timezone.now(), last_imported_by=actor, updated_at=timezone.now())
    record_audit_event(actor=actor, institution=session.institution, entity=session, action="accounting.reconciliation.statement_imported",
                       metadata={"created": created, "skipped": skipped, "errors": len(errors)})
    return {"created": created, "skipped": skipped, "errors": errors[:20]}


@transaction.atomic
def flag_statement_line(*, statement_line, actor, exception, note=""):
    line = BankStatementLine.objects.select_for_update().get(pk=statement_line.pk)
    _require(actor, line.institution, "bank_reconciliation.manage")
    if line.status == BankStatementLine.Status.MATCHED:
        raise CodedValidationError({"status": "Unmatch the line before flagging it."}, api_code="invalid_state_transition")
    if exception and not (note or "").strip():
        raise CodedValidationError({"note": "Explain the exception (for example, bank charge not yet journalled)."}, api_code="validation_error")
    line.status = BankStatementLine.Status.EXCEPTION if exception else BankStatementLine.Status.UNMATCHED
    line.exception_note = note.strip() if exception else ""
    line.save()
    record_audit_event(actor=actor, institution=line.institution, entity=line,
                       action="accounting.bank_statement_line.flagged" if exception else "accounting.bank_statement_line.unflagged", metadata={"note": line.exception_note})
    return line
