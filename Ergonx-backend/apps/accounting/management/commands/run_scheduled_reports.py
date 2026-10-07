from django.core.management.base import BaseCommand

from apps.accounting.reporting import run_due_reports
from apps.reports.library import run_due_items


class Command(BaseCommand):
    help = "Run scheduled financial reports and saved analytics reports whose next run date has arrived (run daily from cron)."

    def handle(self, *args, **options):
        self.stdout.write(f"Ran {run_due_reports()} scheduled financial report(s) and {run_due_items()} saved analytics report(s).")
