from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounting.models import (
    Account,
    AccountingPeriod,
    AccountingPreset,
    AccountingPresetVersion,
    AccountTemplate,
    BankAccount,
    ChartOfAccountsTemplate,
    FiscalYear,
    JournalEntry,
)
from apps.accounting.services import (
    apply_accounting_preset,
    approve_journal,
    create_account,
    create_accounting_period,
    create_fiscal_year,
    create_journal,
    post_journal,
    submit_journal,
)
from apps.institutions.models import Institution, InstitutionMembership, InstitutionModule
from apps.institutions.services import bootstrap_institution


DEMO_INSTITUTION_CODE = "ERGONX-DEMO-ACCOUNTING"
DEMO_ADMIN_EMAIL = "demo.accounting@ergonx.local"
DEMO_PRESET_CODE = "GH-DEMO-COMMERCIAL"


class Command(BaseCommand):
    help = "Create an idempotent, development-only Accounting Core demonstration ledger."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="ErgonX-Demo-2026!",
            help="Password assigned to the accounting demo administrator.",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "seed_accounting_demo is development-only and refuses to run when DEBUG=False."
            )
        try:
            with transaction.atomic():
                result = self._seed(options["password"])
        except ValidationError as exc:
            raise CommandError(f"Accounting demo validation failed: {exc}") from exc

        self.stdout.write(self.style.SUCCESS("Deterministic Accounting Core demo is ready."))
        self.stdout.write(f"Institution: {result['institution'].code}")
        self.stdout.write(f"Admin login: {DEMO_ADMIN_EMAIL}")
        self.stdout.write(f"Fiscal year: {result['fiscal_year'].name}")
        self.stdout.write(f"Period: {result['period'].name}")
        self.stdout.write(f"Posted journals: {len(result['journals'])}")

    def _ensure_admin(self, institution, password):
        user, created = User.objects.get_or_create(
            email=DEMO_ADMIN_EMAIL,
            defaults={"first_name": "Ama", "last_name": "Accountant"},
        )
        if created or not user.check_password(password):
            user.set_password(password)
            user.save(update_fields=("password", "updated_at"))
        role = institution.roles.get(code="INSTITUTION_ADMIN")
        membership, _ = InstitutionMembership.objects.get_or_create(
            user=user,
            institution=institution,
            defaults={
                "role": role,
                "status": InstitutionMembership.Status.ACTIVE,
                "is_primary": True,
                "joined_at": timezone.now(),
            },
        )
        if (
            membership.role_id != role.id
            or membership.status != InstitutionMembership.Status.ACTIVE
            or not membership.is_primary
        ):
            membership.role = role
            membership.status = InstitutionMembership.Status.ACTIVE
            membership.is_primary = True
            membership.ended_at = None
            membership.save()
        return user

    def _ensure_account(self, institution, actor, **values):
        account = Account.objects.filter(
            institution=institution, code=values["code"]
        ).first()
        if account is None:
            return create_account(institution=institution, actor=actor, **values)
        expected = {key: value for key, value in values.items() if key != "code"}
        if any(getattr(account, key) != value for key, value in expected.items()):
            raise CommandError(
                f"Existing demo account {account.code} has drifted; refusing to rewrite it."
            )
        return account

    def _ensure_demo_preset(self):
        preset, _ = AccountingPreset.objects.get_or_create(
            code=DEMO_PRESET_CODE,
            defaults={
                "country_code": "GH",
                "name": "Ghana Commercial Demo",
                "description": "Development-only preset; not statutory production data.",
                "institution_type": "COMMERCIAL",
                "is_system_managed": False,
            },
        )
        expected_preset = {
            "country_code": "GH",
            "institution_type": "COMMERCIAL",
            "is_system_managed": False,
        }
        if any(getattr(preset, key) != value for key, value in expected_preset.items()):
            raise CommandError("Existing accounting demo preset has drifted.")
        version, _ = AccountingPresetVersion.objects.get_or_create(
            accounting_preset=preset,
            version_code="GH-DEMO-COMMERCIAL-2026.1",
            defaults={
                "localization_version": "DEMO-ONLY",
                "effective_from": date(2026, 1, 1),
                "reporting_framework": "IFRS",
                "status": AccountingPresetVersion.Status.ACTIVE,
                "source_metadata": {
                    "demo_only": True,
                    "production_use": "prohibited",
                },
            },
        )
        if (
            version.status != AccountingPresetVersion.Status.ACTIVE
            or version.effective_from != date(2026, 1, 1)
            or version.reporting_framework != "IFRS"
        ):
            raise CommandError("Existing accounting demo preset version has drifted.")
        chart, _ = ChartOfAccountsTemplate.objects.get_or_create(
            preset_version=version,
            name="Demo starter chart",
            defaults={"description": "Flat demonstration chart for Accounting Core."},
        )
        account_specs = (
            ("1000", "Cash at bank", Account.AccountType.ASSET, Account.NormalBalance.DEBIT, "CASH"),
            ("3000", "Owner's equity", Account.AccountType.EQUITY, Account.NormalBalance.CREDIT, "EQUITY"),
            ("4000", "Service income", Account.AccountType.INCOME, Account.NormalBalance.CREDIT, "SERVICE_INCOME"),
            ("5000", "Rent expense", Account.AccountType.EXPENSE, Account.NormalBalance.DEBIT, "RENT_EXPENSE"),
        )
        for code, name, account_type, normal_balance, mapping_code in account_specs:
            template, _ = AccountTemplate.objects.get_or_create(
                coa_template=chart,
                code=code,
                defaults={
                    "name": name,
                    "account_type": account_type,
                    "normal_balance": normal_balance,
                    "is_postable": True,
                    "system_mapping_code": mapping_code,
                },
            )
            expected = (name, account_type, normal_balance, True, mapping_code)
            actual = (
                template.name,
                template.account_type,
                template.normal_balance,
                template.is_postable,
                template.system_mapping_code,
            )
            if actual != expected:
                raise CommandError(f"Existing demo account template {code} has drifted.")
        return version, chart

    def _ensure_posted_journal(self, institution, actor, period, reference, **values):
        journal = JournalEntry.objects.filter(
            institution=institution, reference=reference
        ).first()
        if journal is None:
            journal = create_journal(
                institution=institution,
                actor=actor,
                accounting_period=period,
                reference=reference,
                **values,
            )
        if journal.status == JournalEntry.Status.DRAFT:
            journal = submit_journal(journal=journal, actor=actor)
        if journal.status == JournalEntry.Status.PENDING_APPROVAL:
            journal = approve_journal(journal=journal, actor=actor, system=True)  # demo seed: recorded history, not a live approval
        if journal.status == JournalEntry.Status.APPROVED:
            journal = post_journal(journal=journal, actor=actor)
        if journal.status != JournalEntry.Status.POSTED:
            raise CommandError(
                f"Demo journal {reference} is {journal.status}; expected POSTED."
            )
        return journal

    def _seed(self, password):
        institution, _ = Institution.objects.update_or_create(
            code=DEMO_INSTITUTION_CODE,
            defaults={
                "name": "ErgonX Accounting Core Demo",
                "email": "demo.accounting@ergonx.local",
                "country_code": "GH",
                "default_currency": "GHS",
                "timezone": "Africa/Accra",
                "is_active": True,
            },
        )
        bootstrap_institution(institution)
        actor = self._ensure_admin(institution, password)
        module = institution.modules.get(module_code=InstitutionModule.ModuleCode.ACCOUNTING)
        module.is_enabled = True
        module.enabled_at = module.enabled_at or timezone.now()
        module.enabled_by = actor
        module.configuration_status = InstitutionModule.ConfigurationStatus.READY
        module.save()

        preset_version, chart = self._ensure_demo_preset()
        apply_accounting_preset(
            institution=institution,
            actor=actor,
            preset_version=preset_version,
            coa_template=chart,
            base_currency="GHS",
            fiscal_year_start_month=1,
        )

        fiscal_year = FiscalYear.objects.filter(
            institution=institution, name="FY2026"
        ).first()
        if fiscal_year is None:
            fiscal_year = create_fiscal_year(
                institution=institution,
                actor=actor,
                name="FY2026",
                start_date=date(2026, 1, 1),
                end_date=date(2026, 12, 31),
            )
        periods = []
        for month in range(1, 10):
            start = date(2026, month, 1)
            end = date(2026, month + 1, 1) - date.resolution if month < 12 else date(2026, 12, 31)
            period, _ = AccountingPeriod.objects.get_or_create(
                institution=institution,
                name=start.strftime("%B 2026"),
                defaults={"fiscal_year": fiscal_year, "start_date": start, "end_date": end},
            )
            periods.append(period)
        period = periods[-1]

        cash = self._ensure_account(
            institution,
            actor,
            code="1000",
            name="Cash at bank",
            account_type=Account.AccountType.ASSET,
            normal_balance=Account.NormalBalance.DEBIT,
        )
        equity = self._ensure_account(
            institution,
            actor,
            code="3000",
            name="Owner's equity",
            account_type=Account.AccountType.EQUITY,
            normal_balance=Account.NormalBalance.CREDIT,
        )
        rent = self._ensure_account(
            institution,
            actor,
            code="5000",
            name="Rent expense",
            account_type=Account.AccountType.EXPENSE,
            normal_balance=Account.NormalBalance.DEBIT,
        )
        income = self._ensure_account(institution, actor, code="4000", name="Service income", account_type=Account.AccountType.INCOME, normal_balance=Account.NormalBalance.CREDIT)
        BankAccount.objects.get_or_create(institution=institution, name="Demo Operating Account", defaults={"bank_name": "ErgonX Demo Bank", "masked_account_number": "•••• 2026", "currency": "GHS", "ledger_account": cash, "is_active": True})
        journals = []
        for index, month_period in enumerate(periods):
            month = index + 1
            income_amount = Decimal(12000 + (month * 850) + ((month % 3) * 500))
            expense_amount = Decimal(5200 + (month * 275) + ((month % 2) * 350))
            if month == 1:
                journals.append(self._ensure_posted_journal(institution, actor, month_period, "DEMO-OPENING-2026", entry_date=date(2026, 1, 2), description="Opening capital", lines=[{"account": cash, "debit": Decimal("25000.00"), "credit": Decimal("0.00")}, {"account": equity, "debit": Decimal("0.00"), "credit": Decimal("25000.00")}]))
            journals.append(self._ensure_posted_journal(institution, actor, month_period, f"DEMO-INCOME-2026-{month:02d}", entry_date=date(2026, month, 10), description=f"Monthly service income {month:02d}", lines=[{"account": cash, "debit": income_amount, "credit": Decimal("0.00")}, {"account": income, "debit": Decimal("0.00"), "credit": income_amount}]))
            journals.append(self._ensure_posted_journal(institution, actor, month_period, f"DEMO-RENT-2026-{month:02d}", entry_date=date(2026, month, 20), description=f"Monthly operating expense {month:02d}", lines=[{"account": rent, "debit": expense_amount, "credit": Decimal("0.00")}, {"account": cash, "debit": Decimal("0.00"), "credit": expense_amount}]))
        return {
            "institution": institution,
            "fiscal_year": fiscal_year,
            "period": period,
            "journals": journals,
        }
