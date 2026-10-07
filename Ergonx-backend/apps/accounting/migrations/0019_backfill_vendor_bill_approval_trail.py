"""Fill vendor bill submitter/approver from the existing audit trail.

Bills approved before the approval-trail fields existed still have audit
events recording who submitted and approved them; copy those facts across.
"""
from django.db import migrations


def backfill(apps, schema_editor):
    VendorBill = apps.get_model("accounting", "VendorBill")
    AuditLog = apps.get_model("audit", "AuditLog")
    fields = {"accounting.vendor_bill.submitted": ("submitted_by_id", "submitted_at"), "accounting.vendor_bill.approved": ("approved_by_id", "approved_at")}
    for event in AuditLog.objects.filter(action__in=fields.keys(), entity_id__isnull=False).order_by("created_at").iterator():
        user_field, time_field = fields[event.action]
        VendorBill.objects.filter(pk=event.entity_id, **{f"{user_field}__isnull": True}).update(**{user_field: event.actor_id, time_field: event.created_at})


class Migration(migrations.Migration):
    dependencies = [("accounting", "0018_vendor_bill_workflow"), ("audit", "0001_initial")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
