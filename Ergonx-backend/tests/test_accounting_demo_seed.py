import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.accounting.management.commands.seed_accounting_demo import (
    DEMO_ADMIN_EMAIL,
    DEMO_INSTITUTION_CODE,
)
from apps.accounting.models import (
    Account,
    AccountingPeriod,
    AccountingPreset,
    AccountTemplate,
    InstitutionAccountingConfiguration,
    JournalEntry,
    JournalLine,
)
from apps.accounting.selectors import balance_sheet, income_statement, trial_balance
from apps.audit.models import AuditLog
from apps.institutions.models import Institution
from apps.notifications.models import Notification


pytestmark = pytest.mark.django_db


def test_accounting_demo_seed_refuses_non_debug_settings():
    with pytest.raises(CommandError, match="development-only"):
        call_command("seed_accounting_demo", verbosity=0)
    assert not Institution.objects.filter(code=DEMO_INSTITUTION_CODE).exists()


@override_settings(DEBUG=True)
def test_accounting_demo_seed_is_deterministic_and_report_ready():
    call_command("seed_accounting_demo", verbosity=0)
    institution = Institution.objects.get(code=DEMO_INSTITUTION_CODE)
    counts = {
        "accounts": Account.objects.filter(institution=institution).count(),
        "periods": AccountingPeriod.objects.filter(institution=institution).count(),
        "journals": JournalEntry.objects.filter(institution=institution).count(),
        "lines": JournalLine.objects.filter(journal_entry__institution=institution).count(),
        "audits": AuditLog.objects.filter(institution=institution).count(),
        "notifications": Notification.objects.filter(institution=institution).count(),
    }
    call_command("seed_accounting_demo", verbosity=0)
    assert Account.objects.filter(institution=institution).count() == counts["accounts"] == 4
    assert AccountingPeriod.objects.filter(institution=institution).count() == counts["periods"] == 9
    assert JournalEntry.objects.filter(institution=institution).count() == counts["journals"] == 19
    assert JournalLine.objects.filter(journal_entry__institution=institution).count() == counts["lines"] == 38
    assert AuditLog.objects.filter(institution=institution).count() == counts["audits"]
    assert Notification.objects.filter(institution=institution).count() == counts["notifications"]
    assert institution.memberships.get(user__email=DEMO_ADMIN_EMAIL).user.has_usable_password()
    assert JournalEntry.objects.filter(institution=institution, status=JournalEntry.Status.POSTED).count() == 19
    configuration = InstitutionAccountingConfiguration.objects.get(
        institution=institution
    )
    assert configuration.accounting_setup_mode == "PRESET"
    assert AccountingPreset.objects.filter(code="GH-DEMO-COMMERCIAL").exists()
    assert AccountTemplate.objects.filter(
        coa_template__preset_version=configuration.selected_accounting_preset_version
    ).count() == 4
    assert AuditLog.objects.filter(
        institution=institution, action="accounting.preset.applied"
    ).count() == 1

    trial = trial_balance(institution=institution)
    assert trial["balanced"] is True
    assert trial["total_debit"] == trial["total_credit"]
    assert income_statement(institution=institution)["net_income"] > 0
    statement = balance_sheet(institution=institution)
    assert statement["balanced"] is True
    assert statement["total_assets"] == 114825
