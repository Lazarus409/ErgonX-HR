from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.operations.models import ExportJob, ImportJob
from apps.reports.services import rows_to_csv, build_report_rows
from apps.operations.services import claim_next_background_job, commit_attendance_import, commit_employee_import, complete_background_job, fail_background_job, process_pending_notifications


class Command(BaseCommand):
    help = "Runs one batch of database-backed background jobs. Safe to invoke from a scheduler or worker."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        processed = 0
        while job := claim_next_background_job():
            try:
                if job.job_type == "NOTIFICATION_DELIVERY":
                    count = process_pending_notifications(limit=options["limit"])
                    complete_background_job(job, result_reference=f"notifications:{count}")
                elif job.job_type == "IMPORT_COMMIT":
                    item = ImportJob.objects.get(id=job.metadata["import_job_id"], institution=job.institution)
                    if item.import_type == "EMPLOYEE":
                        count = commit_employee_import(import_job=item)
                    elif item.import_type == "ATTENDANCE":
                        count = commit_attendance_import(import_job=item)
                    else:
                        raise ValueError(f"No import handler registered for {item.import_type!r}.")
                    complete_background_job(job, result_reference=f"imported:{count}")
                elif job.job_type == "EXPORT_GENERATE":
                    item = ExportJob.objects.get(id=job.metadata["export_job_id"], institution=job.institution)
                    item.status = ExportJob.Status.RUNNING
                    item.save(update_fields=("status", "updated_at"))
                    rows = build_report_rows(job.institution, item.export_type, status=item.metadata.get("status"))
                    content = rows_to_csv(rows)
                    if len(content.encode("utf-8")) > 10 * 1024 * 1024:
                        raise ValueError("Export exceeds the 10 MB inline artifact limit.")
                    item.status = ExportJob.Status.COMPLETED
                    item.result_content = content
                    item.result_reference = f"export:{item.export_type}:{item.id}"
                    item.completed_at = timezone.now()
                    item.save(update_fields=("status", "result_content", "result_reference", "completed_at", "updated_at"))
                    complete_background_job(job, result_reference=item.result_reference)
                else:
                    raise ValueError(f"No handler registered for job type {job.job_type!r}.")
                processed += 1
            except Exception as exc:
                if job.job_type == "EXPORT_GENERATE":
                    export_id = job.metadata.get("export_job_id")
                    if export_id:
                        ExportJob.objects.filter(id=export_id, institution=job.institution).update(
                            status=ExportJob.Status.FAILED,
                            error_summary=str(exc)[:2000],
                            completed_at=timezone.now(),
                        )
                fail_background_job(job, error_summary=exc)
        self.stdout.write(self.style.SUCCESS(f"Processed {processed} background job(s)."))
