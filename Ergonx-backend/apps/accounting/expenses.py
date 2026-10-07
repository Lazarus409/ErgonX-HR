"""Expense Management 2.0 (Wave 6; decisions BQ-02, BQ-03, BQ-04, FIN-03).

Locked lifecycle for claims:
    DRAFT -> PENDING (manager stage, engine-resolved) -> FINANCE_REVIEW -> APPROVED
          -> POSTED (accrual) -> SETTLED (settlement recorded)
    with RETURNED (back to the claimant), REJECTED, and a governed REVERSED.

Expenses entered by finance without a claimant ("legacy" expenses) keep the
earlier one-step path: DRAFT -> PENDING -> APPROVED (expense.approve) -> POSTED,
credited to the CASH mapping.

Rules that always hold:
* the claimant never decides their own claim; nobody approves an expense they created;
* only the institution's base currency is accepted until FX is supported (FIN-03);
* every GL account is resolved from institution configuration (categories,
  ``Account.system_mapping_code``); a missing mapping fails closed;
* "settled" records that a settlement happened. ErgonX does not move money.
"""

from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounting.models import Account, Expense, ExpenseApproval, ExpenseCategory, ExpenseLine, InstitutionAccountingConfiguration, JournalEntry
from apps.audit.services import field_changes, record_audit_event
from apps.notifications.models import Notification
from common.exceptions import CodedValidationError

Status = Expense.Status
_MONEY = Decimal("0.01")


# ---- helpers -----------------------------------------------------------------------------


def _services():
    # Late import: services.py imports this module for its public expense API.
    from apps.accounting import services

    return services


def _has(actor, institution, code):
    return actor.memberships.filter(institution=institution, status="ACTIVE", role__permissions__code=code).exists()


def base_currency(institution):
    configuration = InstitutionAccountingConfiguration.objects.filter(institution=institution).first()
    return ((configuration.base_currency if configuration else None) or institution.default_currency or "").upper()


def _ensure_base_currency(institution, currency):
    expected = base_currency(institution)
    if expected and (currency or "").upper() != expected:
        raise CodedValidationError(
            {"currency": f"Expenses must be in the institution's base currency ({expected}) until foreign-exchange rates are supported."},
            api_code="policy_not_applicable",
        )


def _own_employee(actor, institution):
    from apps.employees.models import Employee

    return Employee.objects.filter(institution=institution, user=actor).first()


def _is_claimant(actor, expense):
    return expense.claimant_id is not None and expense.claimant.user_id == actor.id


def _notify(user, expense, notification_type, title, message, route="/me/expenses"):
    if user is None:
        return
    Notification.objects.create(
        institution=expense.institution, user=user, notification_type=notification_type, title=title, message=message,
        channel=Notification.Channel.IN_APP, metadata={"expense_id": str(expense.id), "route_hint": route},
    )


def _notify_holders(expense, permission, notification_type, title, message):
    for membership in expense.institution.memberships.filter(status="ACTIVE", role__permissions__code=permission).select_related("user").distinct():
        if _is_claimant(membership.user, expense):
            continue
        _notify(membership.user, expense, notification_type, title, message, route="/accounting/expenses")


def _transition(before, after, **metadata):
    return {"before": {"status": before}, "after": {"status": after}, **metadata}


def _lock(expense):
    # Lock only the expense row: PostgreSQL refuses FOR UPDATE on the nullable claimant join.
    return Expense.objects.select_for_update(of=("self",)).select_related("claimant__user", "institution").get(pk=expense.pk)


def _claimant_name(expense):
    return expense.claimant.full_name if expense.claimant_id else "an expense"


# ---- lines ---------------------------------------------------------------------------------


def _write_lines(expense, lines):
    """Replace a draft claim's lines; the claim amount is their total."""
    from apps.documents.models import Document

    if not lines:
        raise CodedValidationError({"lines": "Add at least one expense line."}, api_code="validation_error")
    expense.lines.all().delete()
    total = Decimal("0")
    for sequence, row in enumerate(lines, start=1):
        category = row["category"]
        if isinstance(category, str):
            category = ExpenseCategory.objects.get(pk=category, institution=expense.institution)
        if category.institution_id != expense.institution_id:
            raise CodedValidationError({"lines": "Category belongs to another institution."}, api_code="validation_error")
        if not category.is_active:
            raise CodedValidationError({"lines": f"{category.name} is no longer available."}, api_code="validation_error")
        amount = Decimal(str(row["amount"])).quantize(_MONEY)
        line = ExpenseLine(
            institution=expense.institution, expense=expense, category=category, account=category.expense_account,
            expense_date=row.get("expense_date") or expense.expense_date, description=str(row.get("description") or category.name)[:255],
            amount=amount, sequence=sequence,
        )
        line.save()
        receipts = list(row.get("receipts") or [])
        if receipts:
            ids = [getattr(item, "pk", item) for item in receipts]
            documents = list(Document.objects.filter(institution=expense.institution, pk__in=ids))
            if len(documents) != len(set(map(str, ids))):
                raise CodedValidationError({"lines": "A receipt belongs to another institution or does not exist."}, api_code="validation_error")
            line.receipts.set(documents)
        total += amount
    expense.amount = total
    expense.expense_date = min(line.expense_date for line in expense.lines.all())
    expense.save(update_fields=("amount", "expense_date", "updated_at"))


# ---- policy checks (E-05) ------------------------------------------------------------------


def policy_checks(expense):
    """pass / warn / fail / not_evaluated per rule. Unknown is never reported as compliant."""
    checks = []
    expected = base_currency(expense.institution)
    checks.append({"code": "currency", "label": "Base currency", "status": "pass" if not expected or expense.currency == expected else "fail", "detail": f"Claimed in {expense.currency}; base currency is {expected or 'not configured'}."})
    lines = list(expense.lines.select_related("category").prefetch_related("receipts"))
    if not lines:
        checks.append({"code": "lines", "label": "Expense lines", "status": "not_evaluated" if expense.claimant_id is None else "fail", "detail": "Single-amount expense entered by finance." if expense.claimant_id is None else "The claim has no lines."})
        return checks
    today = timezone.localdate()
    future = [line for line in lines if line.expense_date > today]
    checks.append({"code": "future_date", "label": "Expense dates", "status": "fail" if future else "pass", "detail": f"{len(future)} line(s) dated in the future." if future else "All lines are dated today or earlier."})
    over_limit = [line for line in lines if line.category.max_amount is not None and line.amount > line.category.max_amount]
    checks.append({"code": "category_limit", "label": "Category limits", "status": "fail" if over_limit else "pass", "detail": "; ".join(f"{line.category.name}: {line.amount} over the {line.category.max_amount} limit" for line in over_limit) or "Every line is within its category limit."})
    missing = [line for line in lines if line.category.receipt_required_over is not None and line.amount > line.category.receipt_required_over and not line.receipts.exists()]
    checks.append({"code": "receipts", "label": "Receipts", "status": "fail" if missing else "pass", "detail": f"{len(missing)} line(s) need a receipt." if missing else "Receipts are attached where required."})
    if expense.claimant_id:
        duplicates = ExpenseLine.objects.filter(
            institution=expense.institution, expense__claimant=expense.claimant,
            expense_date__in=[line.expense_date for line in lines], amount__in=[line.amount for line in lines],
        ).exclude(expense=expense).exclude(expense__status__in=(Status.REJECTED, Status.REVERSED)).count()
        checks.append({"code": "duplicates", "label": "Possible duplicates", "status": "warn" if duplicates else "pass", "detail": f"{duplicates} line(s) on other claims share a date and amount." if duplicates else "No matching lines on other claims."})
    else:
        checks.append({"code": "duplicates", "label": "Possible duplicates", "status": "not_evaluated", "detail": "No claimant to compare against."})
    return checks


def _failed(checks):
    return [check for check in checks if check["status"] == "fail"]


# ---- create / edit ---------------------------------------------------------------------------


@transaction.atomic
def create_expense(*, institution, actor, lines=None, claimant=None, **values):
    """Create a claim (with lines and a claimant) or a finance-entered expense (account + amount)."""
    own = _own_employee(actor, institution)
    on_behalf = _has(actor, institution, "expense.create")
    if lines is not None or claimant is not None:
        claimant = claimant or own
        if claimant is None:
            raise CodedValidationError({"claimant": "Your account is not linked to an employee record."}, api_code="validation_error")
        if claimant.institution_id != institution.id:
            raise CodedValidationError({"claimant": "Claimant belongs to another institution."}, api_code="validation_error")
        if not (on_behalf or (own is not None and claimant.pk == own.pk and _has(actor, institution, "expense.claim_own"))):
            raise CodedValidationError({"actor": "You can only claim your own expenses."}, api_code="permission_denied")
        values.setdefault("currency", base_currency(institution))
        values.setdefault("payment_method", Expense.PaymentMethod.REIMBURSABLE)
        values.setdefault("expense_date", timezone.localdate())
        values.pop("account", None)
        _ensure_base_currency(institution, values["currency"])
        expense = Expense(institution=institution, created_by=actor, claimant=claimant, amount=Decimal("0.01"), **values)
        expense.save()
        _write_lines(expense, lines or [])
    else:
        _services()._require(actor, institution, "expense.create")
        values["currency"] = values.get("currency") or base_currency(institution)
        _ensure_base_currency(institution, values["currency"])
        values["account"] = Account.objects.select_for_update().get(pk=values["account"].pk)
        expense = Expense(institution=institution, created_by=actor, **values)
        expense.save()
    record_audit_event(actor=actor, institution=institution, entity=expense, action="accounting.expense.created", metadata={"claimant": str(expense.claimant_id) if expense.claimant_id else None, "amount": str(expense.amount)})
    return expense


@transaction.atomic
def update_draft_expense(*, expense, actor, lines=None, **values):
    expense = _lock(expense)
    if expense.status not in (Status.DRAFT, Status.RETURNED):
        raise CodedValidationError({"status": "Only draft or returned expenses can be edited."}, api_code="record_immutable")
    if not (expense.created_by_id == actor.id or _is_claimant(actor, expense) or _has(actor, expense.institution, "expense.create")):
        raise CodedValidationError({"actor": "Only the claimant or finance can edit this expense."}, api_code="permission_denied")
    values.pop("claimant", None)
    if "currency" in values:
        _ensure_base_currency(expense.institution, values["currency"])
    if "account" in values and values["account"] is not None:
        values["account"] = Account.objects.select_for_update().get(pk=values["account"].pk)
    for field, value in values.items():
        setattr(expense, field, value)
    expense.save()
    if lines is not None:
        _write_lines(expense, lines)
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.updated")
    return expense


# ---- submit and the manager stage (E-08) -------------------------------------------------------


def _manager_chain(expense):
    """Approvers for the manager stage: the EXPENSE_CLAIM workflow, else the line manager or head."""
    from apps.employees.models import Employment
    from apps.workflows.engine import Trigger, department_head_of, resolve_chain, resolve_definition

    claimant = expense.claimant
    employment = Employment.objects.filter(employee=claimant, is_current=True).select_related("department", "reports_to__employee__user").first()
    definition = resolve_definition(expense.institution, Trigger.EXPENSE_CLAIM, department=employment.department if employment else None, amount=expense.amount)
    if definition is not None and definition.steps.exists():
        return [(step.name, user) for step, user in resolve_chain(definition, institution=expense.institution, requester=claimant.user, employment=employment, employee_id=claimant.id)]
    approver = None
    if employment and employment.reports_to_id:
        candidate = employment.reports_to.employee.user
        if candidate and candidate.pk != claimant.user_id and candidate.memberships.filter(institution=expense.institution, status="ACTIVE").exists():
            approver = candidate
    if approver is None and employment:
        approver = department_head_of(employment.department, exclude_employee_id=claimant.id, institution=expense.institution)
    return [("Manager approval", approver)] if approver else []


@transaction.atomic
def submit_expense(*, expense, actor):
    expense = _lock(expense)
    if expense.status == Status.PENDING or expense.status == Status.FINANCE_REVIEW:
        return expense
    if expense.status not in (Status.DRAFT, Status.RETURNED):
        raise CodedValidationError({"status": "Only draft or returned expenses can be submitted."}, api_code="invalid_state_transition")
    if not (expense.created_by_id == actor.id or _is_claimant(actor, expense) or _has(actor, expense.institution, "expense.create")):
        raise CodedValidationError({"actor": "Only the claimant or finance can submit this expense."}, api_code="permission_denied")
    _ensure_base_currency(expense.institution, expense.currency)
    before = expense.status
    if expense.claimant_id is None:
        _services()._require(actor, expense.institution, "expense.create")
        expense.status = Status.PENDING
        expense.submitted_at = timezone.now()
        expense.save(update_fields=("status", "submitted_at", "updated_at"))
        _notify_holders(expense, "expense.approve", "EXPENSE_APPROVAL_REQUIRED", "Expense approval required", f"Expense requires approval: {expense.description[:80]}")
        record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.submitted", metadata=_transition(before, Status.PENDING))
        return expense

    failures = _failed(policy_checks(expense))
    if failures:
        raise CodedValidationError({"policy": [f"{check['label']}: {check['detail']}" for check in failures]}, api_code="policy_not_applicable")
    chain = _manager_chain(expense)
    start = (expense.approvals.order_by("-sequence").values_list("sequence", flat=True).first() or 0) + 1
    for offset, (name, approver) in enumerate(chain):
        ExpenseApproval.objects.create(institution=expense.institution, expense=expense, sequence=start + offset, step_name=name, approver=approver)
    expense.status = Status.PENDING if chain else Status.FINANCE_REVIEW
    expense.submitted_at = timezone.now()
    expense.decision_note = ""
    expense.save(update_fields=("status", "submitted_at", "decision_note", "updated_at"))
    if chain:
        _notify(chain[0][1], expense, "EXPENSE_APPROVAL_REQUIRED", "Expense claim to approve", f"{_claimant_name(expense)} submitted a claim for {expense.amount} {expense.currency}.", route="/approvals")
    else:
        _notify_holders(expense, "expense.finance_review", "EXPENSE_FINANCE_REVIEW", "Expense claim for finance review", f"{_claimant_name(expense)}: {expense.amount} {expense.currency}.")
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.submitted", metadata=_transition(before, expense.status, approvers=[str(user.id) for _, user in chain]))
    return expense


def _current_step(expense):
    return expense.approvals.select_for_update().filter(status=ExpenseApproval.Status.PENDING).order_by("sequence").first()


@transaction.atomic
def decide_expense_step(*, expense, actor, decision, comment=""):
    """Manager-stage decision on a claim: approve, return or reject."""
    expense = _lock(expense)
    if expense.status != Status.PENDING or expense.claimant_id is None:
        raise CodedValidationError({"status": "Only submitted claims awaiting a manager can be decided here."}, api_code="invalid_state_transition")
    if _is_claimant(actor, expense):
        raise CodedValidationError({"actor": "You cannot decide your own expense claim."}, api_code="permission_denied")
    step = _current_step(expense)
    if step is None or step.approver_id != actor.id:
        raise CodedValidationError({"actor": "This is not your approval step."}, api_code="permission_denied")
    if decision in ("return", "reject") and not comment.strip():
        raise CodedValidationError({"comment": "Explain the decision to the claimant."}, api_code="validation_error")
    step.status = {"approve": ExpenseApproval.Status.APPROVED, "return": ExpenseApproval.Status.RETURNED, "reject": ExpenseApproval.Status.REJECTED}[decision]
    step.comment, step.acted_at = comment, timezone.now()
    step.save(update_fields=("status", "comment", "acted_at", "updated_at"))
    if decision == "approve":
        following = expense.approvals.filter(status=ExpenseApproval.Status.PENDING).order_by("sequence").first()
        if following:
            _notify(following.approver, expense, "EXPENSE_APPROVAL_REQUIRED", "Expense claim to approve", f"{_claimant_name(expense)}: {expense.amount} {expense.currency}.", route="/approvals")
            action = "accounting.expense.step_approved"
        else:
            expense.status = Status.FINANCE_REVIEW
            expense.save(update_fields=("status", "updated_at"))
            _notify_holders(expense, "expense.finance_review", "EXPENSE_FINANCE_REVIEW", "Expense claim for finance review", f"{_claimant_name(expense)}: {expense.amount} {expense.currency}.")
            action = "accounting.expense.manager_approved"
    else:
        expense.approvals.filter(status=ExpenseApproval.Status.PENDING).delete()
        expense.status = Status.RETURNED if decision == "return" else Status.REJECTED
        expense.decision_note = comment
        expense.save(update_fields=("status", "decision_note", "updated_at"))
        _notify(expense.claimant.user, expense, f"EXPENSE_{expense.status}", f"Expense claim {expense.get_status_display().lower()}", comment)
        action = f"accounting.expense.{'returned' if decision == 'return' else 'rejected'}"
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action=action, metadata=_transition(Status.PENDING, expense.status, step=step.sequence, comment=comment))
    return expense


# ---- finance review (E-10) ---------------------------------------------------------------------


@transaction.atomic
def finance_review_expense(*, expense, actor, decision, comment="", recodes=None):
    """Finance checks policy, may recode line accounts, then approves, returns or rejects."""
    expense = _lock(expense)
    _services()._require(actor, expense.institution, "expense.finance_review")
    if expense.status != Status.FINANCE_REVIEW:
        raise CodedValidationError({"status": "Only claims in finance review can be reviewed."}, api_code="invalid_state_transition")
    if _is_claimant(actor, expense) or expense.created_by_id == actor.id:
        raise CodedValidationError({"actor": "You cannot review an expense you claimed or created."}, api_code="permission_denied")
    if decision in ("return", "reject") and not comment.strip():
        raise CodedValidationError({"comment": "Explain the decision to the claimant."}, api_code="validation_error")
    for line_id, account in (recodes or {}).items():
        line = expense.lines.select_for_update().get(pk=line_id)
        account = account if isinstance(account, Account) else Account.objects.get(pk=account, institution=expense.institution)
        if account.institution_id != expense.institution_id or account.account_type != Account.AccountType.EXPENSE or not account.is_postable:
            raise CodedValidationError({"recodes": "Recode to a postable expense account of this institution."}, api_code="validation_error")
        if line.account_id != account.id:
            before = {"account": line.account.code}
            line.account = account
            line.save(update_fields=("account", "updated_at"))
            record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.recoded", metadata={"line": str(line.id), "changes": field_changes(before, {"account": account.code})})
    if decision == "approve":
        # Finance may accept a missing receipt only with a written justification;
        # every other failed rule blocks approval.
        failures = [check for check in _failed(policy_checks(expense)) if check["code"] != "receipts" or not comment.strip()]
        if failures:
            raise CodedValidationError({"policy": [f"{check['label']}: {check['detail']}" for check in failures]}, api_code="policy_not_applicable")
        expense.status, expense.approved_by = Status.APPROVED, actor
    else:
        expense.status = Status.RETURNED if decision == "return" else Status.REJECTED
    expense.finance_reviewed_by, expense.finance_reviewed_at, expense.decision_note = actor, timezone.now(), comment
    expense.save(update_fields=("status", "approved_by", "finance_reviewed_by", "finance_reviewed_at", "decision_note", "updated_at"))
    if expense.claimant_id:
        _notify(expense.claimant.user, expense, f"EXPENSE_{expense.status}", f"Expense claim {expense.get_status_display().lower()}", comment or f"Your claim for {expense.amount} {expense.currency} was {expense.get_status_display().lower()}.")
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.finance_reviewed", metadata=_transition(Status.FINANCE_REVIEW, expense.status, comment=comment))
    return expense


# ---- legacy one-step approval ------------------------------------------------------------------


@transaction.atomic
def approve_expense(*, expense, actor):
    expense = _lock(expense)
    if expense.claimant_id is not None:
        if expense.status == Status.PENDING:
            return decide_expense_step(expense=expense, actor=actor, decision="approve")
        raise CodedValidationError({"status": "Use finance review for claims past the manager stage."}, api_code="invalid_state_transition")
    _services()._require(actor, expense.institution, "expense.approve")
    if expense.status == Status.APPROVED:
        return expense
    if expense.status != Status.PENDING:
        raise CodedValidationError({"status": "Only pending expenses can be approved."}, api_code="invalid_state_transition")
    if expense.created_by_id == actor.id:
        raise CodedValidationError({"actor": "You cannot approve an expense you created (separation of duties)."}, api_code="separation_of_duties")
    expense.status, expense.approved_by = Status.APPROVED, actor
    expense.save(update_fields=("status", "approved_by", "updated_at"))
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.approved", metadata=_transition(Status.PENDING, Status.APPROVED))
    return expense


@transaction.atomic
def reject_expense(*, expense, actor, comment=""):
    expense = _lock(expense)
    if expense.claimant_id is not None and expense.status == Status.PENDING:
        return decide_expense_step(expense=expense, actor=actor, decision="reject", comment=comment or "Rejected.")
    _services()._require(actor, expense.institution, "expense.approve")
    if expense.status == Status.REJECTED:
        return expense
    if expense.status != Status.PENDING:
        raise CodedValidationError({"status": "Only pending expenses can be rejected."}, api_code="invalid_state_transition")
    if expense.created_by_id == actor.id:
        raise CodedValidationError({"actor": "You cannot decide an expense you created (separation of duties)."}, api_code="separation_of_duties")
    expense.status = Status.REJECTED
    expense.decision_note = comment
    expense.save(update_fields=("status", "decision_note", "updated_at"))
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.rejected", metadata=_transition(Status.PENDING, Status.REJECTED))
    return expense


# ---- posting, settlement, reversal (E-12, E-14, E-15) -------------------------------------------


@transaction.atomic
def post_expense(*, expense, actor):
    services = _services()
    expense = _lock(expense)
    services._require(actor, expense.institution, "expense.post")
    if expense.status == Status.POSTED:
        return expense
    if expense.status != Status.APPROVED:
        raise CodedValidationError({"status": "Only approved expenses can be posted."}, api_code="invalid_state_transition")
    _ensure_base_currency(expense.institution, expense.currency)
    period = services._cash_transaction_period(institution=expense.institution, transaction_date=expense.expense_date, field_name="expense_date")
    lines = list(expense.lines.select_related("account"))
    if lines:
        debits = {}
        for line in lines:
            debits[line.account] = debits.get(line.account, Decimal("0")) + line.amount
        journal_lines = [{"account": account, "description": expense.description[:255], "debit": amount, "credit": Decimal("0")} for account, amount in debits.items()]
    else:
        journal_lines = [{"account": expense.account, "description": expense.description, "debit": expense.amount, "credit": Decimal("0")}]
    reimbursable = expense.payment_method == Expense.PaymentMethod.REIMBURSABLE
    credit_account = services._mapping_account(expense.institution, "EMPLOYEE_PAYABLE" if reimbursable else "CASH")
    journal_lines.append({"account": credit_account, "description": f"Owed to {_claimant_name(expense)}" if reimbursable else "Cash expense", "debit": Decimal("0"), "credit": expense.amount})
    journal = services._create_journal_record(institution=expense.institution, actor=actor, source=JournalEntry.Source.EXPENSE, accounting_period=period, entry_date=expense.expense_date, description=f"Expense: {expense.description}"[:255], reference=f"EXPENSE-{expense.id}", lines=journal_lines)
    journal = services.submit_journal(journal=journal, actor=actor)
    journal = services.approve_journal(journal=journal, actor=actor, system=True, upstream_approver=expense.approved_by)
    journal = services.post_journal(journal=journal, actor=actor)
    expense.status, expense.journal_entry = Status.POSTED, journal
    expense.save(update_fields=("status", "journal_entry", "updated_at"))
    if expense.claimant_id:
        _notify(expense.claimant.user, expense, "EXPENSE_POSTED", "Expense claim posted", f"Your claim for {expense.amount} {expense.currency} is recorded in the ledger{' and awaits settlement' if reimbursable else ''}.")
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.posted", metadata=_transition(Status.APPROVED, Status.POSTED, journal_entry_id=str(journal.id), credit=credit_account.system_mapping_code))
    return expense


@transaction.atomic
def settle_expense(*, expense, actor, settlement_account, settlement_date=None, reference=""):
    """Record that a reimbursable claim was settled (Dr employee payable / Cr bank or cash)."""
    services = _services()
    expense = _lock(expense)
    services._require(actor, expense.institution, "expense.settle")
    if expense.status == Status.SETTLED:
        return expense
    if expense.status != Status.POSTED:
        raise CodedValidationError({"status": "Only posted claims can be settled."}, api_code="invalid_state_transition")
    if expense.payment_method != Expense.PaymentMethod.REIMBURSABLE:
        raise CodedValidationError({"payment_method": "Petty-cash expenses were paid when posted; there is nothing to settle."}, api_code="invalid_state_transition")
    account = settlement_account if isinstance(settlement_account, Account) else Account.objects.get(pk=settlement_account, institution=expense.institution)
    if account.institution_id != expense.institution_id or account.account_type != Account.AccountType.ASSET or not (account.is_active and account.is_postable):
        raise CodedValidationError({"settlement_account": "Settle from an active, postable bank or cash account."}, api_code="validation_error")
    settlement_date = settlement_date or timezone.localdate()
    if isinstance(settlement_date, str):
        settlement_date = date.fromisoformat(settlement_date)
    period = services._cash_transaction_period(institution=expense.institution, transaction_date=settlement_date, field_name="settlement_date")
    payable = services._mapping_account(expense.institution, "EMPLOYEE_PAYABLE")
    journal = services._create_journal_record(
        institution=expense.institution, actor=actor, source=JournalEntry.Source.EXPENSE, accounting_period=period, entry_date=settlement_date,
        description=f"Settlement: {expense.description}"[:255], reference=f"EXPENSE-SETTLE-{expense.id}",
        lines=[
            {"account": payable, "description": f"Settled to {_claimant_name(expense)}", "debit": expense.amount, "credit": Decimal("0")},
            {"account": account, "description": reference or "Expense settlement", "debit": Decimal("0"), "credit": expense.amount},
        ],
    )
    journal = services.submit_journal(journal=journal, actor=actor)
    journal = services.approve_journal(journal=journal, actor=actor, system=True, upstream_approver=expense.approved_by)
    journal = services.post_journal(journal=journal, actor=actor)
    expense.status = Status.SETTLED
    expense.settlement_account, expense.settlement_date, expense.settlement_reference = account, settlement_date, reference[:120]
    expense.settlement_journal, expense.settled_by = journal, actor
    expense.save(update_fields=("status", "settlement_account", "settlement_date", "settlement_reference", "settlement_journal", "settled_by", "updated_at"))
    if expense.claimant_id:
        _notify(expense.claimant.user, expense, "EXPENSE_SETTLED", "Expense settlement recorded", f"Finance recorded settlement of your claim for {expense.amount} {expense.currency} on {settlement_date.isoformat()}.")
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.settled", metadata=_transition(Status.POSTED, Status.SETTLED, journal_entry_id=str(journal.id), reference=reference))
    return expense


@transaction.atomic
def reverse_expense(*, expense, actor, reason, reversal_date=None):
    """Governed correction: reverse the posting journal and end the claim as REVERSED (BQ-02)."""
    services = _services()
    expense = _lock(expense)
    services._require(actor, expense.institution, "expense.post")
    if expense.status == Status.REVERSED:
        return expense
    if expense.status != Status.POSTED:
        raise CodedValidationError({"status": "Only posted, unsettled expenses can be reversed. Settled claims need a settlement correction first."}, api_code="invalid_state_transition")
    if not reason.strip():
        raise CodedValidationError({"reason": "Explain why the expense is reversed."}, api_code="validation_error")
    reversal_date = reversal_date or timezone.localdate()
    if isinstance(reversal_date, str):
        reversal_date = date.fromisoformat(reversal_date)
    period = services._cash_transaction_period(institution=expense.institution, transaction_date=reversal_date, field_name="reversal_date")
    reversal = services.create_reversal(journal=expense.journal_entry, actor=actor, accounting_period=period, entry_date=reversal_date, description=f"Reversal of expense: {reason}"[:255])
    reversal = services.submit_journal(journal=reversal, actor=actor)
    reversal = services.approve_journal(journal=reversal, actor=actor, system=True, upstream_approver=expense.approved_by)
    reversal = services.post_journal(journal=reversal, actor=actor)
    expense.status, expense.reversal_journal, expense.reversed_by = Status.REVERSED, reversal, actor
    expense.save(update_fields=("status", "reversal_journal", "reversed_by", "updated_at"))
    if expense.claimant_id:
        _notify(expense.claimant.user, expense, "EXPENSE_REVERSED", "Expense claim reversed", reason)
    record_audit_event(actor=actor, institution=expense.institution, entity=expense, action="accounting.expense.reversed", metadata=_transition(Status.POSTED, Status.REVERSED, journal_entry_id=str(reversal.id), reason=reason))
    return expense


def validate_line_rows(rows):
    """Normalise API line rows before they reach the service."""
    if not isinstance(rows, list):
        raise ValidationError({"lines": "Provide a list of lines."})
    return rows
