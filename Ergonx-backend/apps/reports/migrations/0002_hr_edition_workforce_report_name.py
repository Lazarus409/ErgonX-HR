"""ErgonX HR edition: the built-in Workforce report shows headcount only.

Library entries keep the name they were created with, so existing built-in
"Workforce Cost" entries are renamed when Payroll is excluded. A no-op for the
full ERP.
"""

from django.conf import settings
from django.db import migrations


def rename_workforce_report(apps, schema_editor):
    if "PAYROLL" not in settings.ERGONX_EXCLUDED_MODULES:
        return
    AnalyticsItem = apps.get_model("reports", "AnalyticsItem")
    AnalyticsItem.objects.filter(is_system=True, source="workforce-cost", name="Workforce Cost").update(
        name="Workforce", description="Headcount by employee status."
    )


class Migration(migrations.Migration):
    dependencies = [("reports", "0001_initial")]

    operations = [migrations.RunPython(rename_workforce_report, migrations.RunPython.noop)]
