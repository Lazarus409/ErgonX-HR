from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Sum
from django.utils import timezone

from apps.accounting.models import (
    Account,
    AccountingPresetVersion,
    ChartOfAccountsTemplate,
    JournalEntry,
    JournalLine,
)


POSTED_STATUSES = (JournalEntry.Status.POSTED, JournalEntry.Status.REVERSED)


def available_accounting_preset_versions(*, institution, as_of=None):
    as_of = as_of or timezone.localdate()
    return AccountingPresetVersion.objects.filter(
        accounting_preset__country_code=institution.country_code,
        status=AccountingPresetVersion.Status.ACTIVE,
        effective_from__lte=as_of,
    ).filter(
        models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=as_of)
    ).select_related("accounting_preset").prefetch_related("coa_templates")


def account_templates_for_application(*, preset_version, coa_template=None):
    templates = ChartOfAccountsTemplate.objects.filter(preset_version=preset_version)
    if coa_template is not None:
        if coa_template.preset_version_id != preset_version.id:
            raise ValidationError(
                {"coa_template": "Chart template belongs to another preset version."}
            )
        templates = templates.filter(pk=coa_template.pk)
    selected = list(templates)
    if not selected:
        raise ValidationError({"coa_template": "Preset version has no chart template."})
    if len(selected) > 1:
        raise ValidationError(
            {"coa_template": "Select one chart template for this preset version."}
        )
    chart = selected[0]
    return chart, chart.account_templates.select_related("parent_template").order_by("code")


def posted_lines(*, institution, date_from=None, date_to=None, account=None):
    if account is not None and account.institution_id != institution.id:
        raise ValidationError({"account": "Account belongs to another institution."})
    queryset = JournalLine.objects.filter(
        journal_entry__institution=institution,
        journal_entry__status__in=POSTED_STATUSES,
    ).select_related("journal_entry", "account")
    if date_from:
        queryset = queryset.filter(journal_entry__entry_date__gte=date_from)
    if date_to:
        queryset = queryset.filter(journal_entry__entry_date__lte=date_to)
    if account:
        queryset = queryset.filter(account=account)
    return queryset.order_by("journal_entry__entry_date", "journal_entry__journal_number", "created_at")


def general_ledger(*, institution, account, date_from=None, date_to=None):
    opening_balance = Decimal("0.00")
    if date_from:
        opening = JournalLine.objects.filter(
            journal_entry__institution=institution,
            journal_entry__status__in=POSTED_STATUSES,
            journal_entry__entry_date__lt=date_from,
            account=account,
        ).aggregate(debit=Sum("debit"), credit=Sum("credit"))
        opening_balance = (opening["debit"] or Decimal("0.00")) - (
            opening["credit"] or Decimal("0.00")
        )
    running = opening_balance
    entries = []
    for line in posted_lines(
        institution=institution,
        account=account,
        date_from=date_from,
        date_to=date_to,
    ):
        running += line.debit - line.credit
        entries.append(
            {
                "journal_entry_id": line.journal_entry_id,
                "journal_number": line.journal_entry.journal_number,
                "entry_date": line.journal_entry.entry_date,
                "description": line.description or line.journal_entry.description,
                "debit": line.debit,
                "credit": line.credit,
                "running_balance": running,
            }
        )
    return {
        "account_id": account.id,
        "account_code": account.code,
        "account_name": account.name,
        "opening_balance": opening_balance,
        "entries": entries,
        "closing_balance": running,
    }


def trial_balance(*, institution, date_from=None, date_to=None):
    aggregated = (
        posted_lines(institution=institution, date_from=date_from, date_to=date_to)
        .order_by()
        .values(
            "account_id",
            "account__code",
            "account__name",
            "account__account_type",
            "account__normal_balance",
        )
        .annotate(debit=Sum("debit"), credit=Sum("credit"))
        .order_by("account__code")
    )
    rows = [
        {
            "account_id": row["account_id"],
            "code": row["account__code"],
            "name": row["account__name"],
            "account_type": row["account__account_type"],
            "normal_balance": row["account__normal_balance"],
            "debit": row["debit"],
            "credit": row["credit"],
        }
        for row in aggregated
    ]
    total_debit = sum((row["debit"] for row in rows), Decimal("0.00"))
    total_credit = sum((row["credit"] for row in rows), Decimal("0.00"))
    return {
        "rows": rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "balanced": total_debit == total_credit,
    }


def income_statement(*, institution, date_from=None, date_to=None):
    rows = trial_balance(
        institution=institution, date_from=date_from, date_to=date_to
    )["rows"]
    income = [row for row in rows if row["account_type"] == Account.AccountType.INCOME]
    expenses = [row for row in rows if row["account_type"] == Account.AccountType.EXPENSE]
    total_income = sum((row["credit"] - row["debit"] for row in income), Decimal("0.00"))
    total_expenses = sum(
        (row["debit"] - row["credit"] for row in expenses), Decimal("0.00")
    )
    return {
        "income": income,
        "expenses": expenses,
        "total_income": total_income,
        "total_expenses": total_expenses,
        "net_income": total_income - total_expenses,
    }


def balance_sheet(*, institution, as_of=None):
    rows = trial_balance(institution=institution, date_to=as_of)["rows"]
    assets = [row for row in rows if row["account_type"] == Account.AccountType.ASSET]
    liabilities = [
        row for row in rows if row["account_type"] == Account.AccountType.LIABILITY
    ]
    equity = [row for row in rows if row["account_type"] == Account.AccountType.EQUITY]
    income = [row for row in rows if row["account_type"] == Account.AccountType.INCOME]
    expenses = [row for row in rows if row["account_type"] == Account.AccountType.EXPENSE]
    total_assets = sum((row["debit"] - row["credit"] for row in assets), Decimal("0.00"))
    total_liabilities = sum(
        (row["credit"] - row["debit"] for row in liabilities), Decimal("0.00")
    )
    opening_equity = sum(
        (row["credit"] - row["debit"] for row in equity), Decimal("0.00")
    )
    retained_result = sum(
        (row["credit"] - row["debit"] for row in income), Decimal("0.00")
    ) - sum((row["debit"] - row["credit"] for row in expenses), Decimal("0.00"))
    total_equity = opening_equity + retained_result
    return {
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "retained_result": retained_result,
        "total_equity": total_equity,
        "balanced": total_assets == total_liabilities + total_equity,
    }
