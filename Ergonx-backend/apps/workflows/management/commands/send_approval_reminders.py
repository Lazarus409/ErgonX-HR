from django.core.management.base import BaseCommand

from apps.workflows.escalation import run_escalations


class Command(BaseCommand):
    help = "Notify approvers (and each workflow's escalation role) about steps past their due time. Run daily or hourly."

    def handle(self, *args, **options):
        result = run_escalations()
        self.stdout.write(f"Escalated {result['generic']} approval request step(s) and {result['leave']} leave approval step(s).")
