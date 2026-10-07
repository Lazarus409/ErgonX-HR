from django.db.models import Avg, Count

from apps.recruitment.models import Application, Candidate, JobPosting


def applications_for_institution(*, institution):
    return (
        Application.objects.for_institution(institution)
        .select_related("job_posting", "candidate", "current_stage")
        .prefetch_related("stage_history", "interviews", "evaluations")
    )


def recruitment_pipeline(*, institution):
    stages = institution.recruitment_stages.filter(is_active=True).order_by("sequence")
    counts = {
        row["current_stage_id"]: row["count"]
        for row in Application.objects.for_institution(institution)
        .filter(status__in=(Application.Status.ACTIVE, Application.Status.OFFERED))
        .values("current_stage_id")
        .annotate(count=Count("id"))
    }
    return [{"stage_id": stage.id, "stage_name": stage.name, "sequence": stage.sequence, "application_count": counts.get(stage.id, 0)} for stage in stages]


def candidate_scorecard(*, institution, candidate):
    if candidate.institution_id != institution.id:
        return None
    return Candidate.objects.for_institution(institution).filter(pk=candidate.pk).annotate(
        average_score=Avg("applications__evaluations__score"),
        application_count=Count("applications", distinct=True),
    ).first()
