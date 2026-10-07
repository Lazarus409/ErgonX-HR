from datetime import datetime, timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.compensation.models import EmployeeCompensation
from apps.employees.models import Employee, EmployeeOnboarding, Employment
from apps.notifications.models import Notification
from apps.institutions.services import record_user_activity
from apps.recruitment.models import (
    Application,
    ApplicationStageHistory,
    Candidate,
    CandidateEvaluation,
    Interview,
    JobPosting,
    Offer,
    RecruitmentStage,
)


def _active_member(actor, institution):
    if actor is None or not actor.memberships.filter(institution=institution, status="ACTIVE").exists():
        raise ValidationError({"actor": "Actor must be an active institution member."})


def _can(actor, institution, code):
    return bool(actor) and actor.memberships.filter(
        institution=institution, status="ACTIVE", role__permissions__code=code
    ).exists()


def _notify(user, instance, notification_type, title, message):
    if user is None:
        return
    Notification.objects.create(
        institution=instance.institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata={"entity_type": instance._meta.label, "entity_id": str(instance.pk)},
    )


@transaction.atomic
def publish_job_posting(*, job_posting, actor):
    posting = JobPosting.objects.select_for_update().get(pk=job_posting.pk)
    _active_member(actor, posting.institution)
    if posting.status == JobPosting.Status.OPEN:
        return posting
    # No shortcut from DRAFT (BQ-06): a requisition is approved by someone
    # other than its submitter before it can be published.
    if posting.status == JobPosting.Status.DRAFT:
        raise ValidationError({"status": "Submit the requisition for approval before publishing."})
    if posting.status != JobPosting.Status.APPROVED:
        raise ValidationError({"status": "Only approved requisitions can be published."})
    posting.status = JobPosting.Status.OPEN
    if posting.opens_on is None:
        posting.opens_on = timezone.localdate()
    posting.full_clean()
    posting.save(update_fields=("status", "opens_on", "approved_by", "approved_at", "updated_at"))
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action="recruitment.job_posting.published")
    _notify(posting.hiring_manager, posting, "RECRUITMENT_JOB_POSTING_OPEN", "Job posting opened", f"{posting.title} is now open.")
    return posting


@transaction.atomic
def close_job_posting(*, job_posting, actor, cancelled=False):
    posting = JobPosting.objects.select_for_update().get(pk=job_posting.pk)
    _active_member(actor, posting.institution)
    target = JobPosting.Status.CANCELLED if cancelled else JobPosting.Status.CLOSED
    if posting.status == target:
        return posting
    if posting.status != JobPosting.Status.OPEN:
        raise ValidationError({"status": "Only open job postings can be closed or cancelled."})
    posting.status = target
    posting.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action=f"recruitment.job_posting.{target.lower()}")
    return posting


@transaction.atomic
def submit_application(*, application, actor):
    instance = Application.objects.select_for_update().select_related("job_posting", "candidate").get(pk=application.pk)
    _active_member(actor, instance.institution)
    if instance.status == Application.Status.ACTIVE:
        return instance
    if instance.status != Application.Status.DRAFT:
        raise ValidationError({"status": "Only draft applications can be submitted."})
    if instance.job_posting.status != JobPosting.Status.OPEN:
        raise ValidationError({"job_posting": "Applications can only be submitted to open job postings."})
    stage = instance.current_stage or RecruitmentStage.objects.for_institution(instance.institution).filter(is_active=True).order_by("sequence").first()
    if stage is None:
        raise ValidationError({"current_stage": "Configure at least one active recruitment stage before submitting an application."})
    instance.current_stage = stage
    instance.status = Application.Status.ACTIVE
    instance.applied_at = timezone.now()
    instance.full_clean()
    instance.save(update_fields=("current_stage", "status", "applied_at", "updated_at"))
    ApplicationStageHistory.objects.create(institution=instance.institution, application=instance, to_stage=stage, changed_by=actor, comment="Application submitted")
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.application.submitted", metadata={"stage_id": str(stage.id)})
    record_user_activity(actor=actor, institution=instance.institution, activity_code="application.submit", entity=instance)
    _notify(instance.job_posting.hiring_manager, instance, "RECRUITMENT_APPLICATION_SUBMITTED", "New application", f"{instance.candidate.full_name} applied for {instance.job_posting.title}.")
    return instance


@transaction.atomic
def move_application_stage(*, application, stage, actor, comment=""):
    instance = Application.objects.select_for_update().get(pk=application.pk)
    _active_member(actor, instance.institution)
    if stage.institution_id != instance.institution_id:
        raise ValidationError({"stage": "Stage belongs to another institution."})
    if not stage.is_active:
        raise ValidationError({"stage": "Cannot move an application to an inactive stage."})
    if instance.status not in (Application.Status.ACTIVE, Application.Status.OFFERED):
        raise ValidationError({"status": "Only active or offered applications can move through the pipeline."})
    if instance.current_stage_id == stage.id:
        return instance
    previous_stage = instance.current_stage
    instance.current_stage = stage
    instance.save(update_fields=("current_stage", "updated_at"))
    ApplicationStageHistory.objects.create(institution=instance.institution, application=instance, from_stage=previous_stage, to_stage=stage, changed_by=actor, comment=comment)
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.application.stage_moved", metadata={"from_stage_id": str(previous_stage.id) if previous_stage else None, "to_stage_id": str(stage.id)})
    return instance


@transaction.atomic
def withdraw_application(*, application, actor):
    instance = Application.objects.select_for_update().get(pk=application.pk)
    _active_member(actor, instance.institution)
    if instance.status == Application.Status.WITHDRAWN:
        return instance
    if instance.status not in (Application.Status.DRAFT, Application.Status.ACTIVE, Application.Status.OFFERED):
        raise ValidationError({"status": "This application cannot be withdrawn."})
    instance.status = Application.Status.WITHDRAWN
    instance.withdrawn_at = timezone.now()
    instance.save(update_fields=("status", "withdrawn_at", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.application.withdrawn")
    return instance


@transaction.atomic
def reject_application(*, application, actor, reason=""):
    instance = Application.objects.select_for_update().get(pk=application.pk)
    _active_member(actor, instance.institution)
    if instance.status == Application.Status.REJECTED:
        return instance
    if instance.status not in (Application.Status.ACTIVE, Application.Status.OFFERED):
        raise ValidationError({"status": "Only active or offered applications can be rejected."})
    instance.status = Application.Status.REJECTED
    instance.rejected_at = timezone.now()
    instance.rejection_reason = reason
    instance.save(update_fields=("status", "rejected_at", "rejection_reason", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.application.rejected")
    return instance


@transaction.atomic
def update_interview_status(*, interview, actor, status):
    instance = Interview.objects.select_for_update().get(pk=interview.pk)
    _active_member(actor, instance.institution)
    if status not in (Interview.Status.COMPLETED, Interview.Status.CANCELLED, Interview.Status.NO_SHOW):
        raise ValidationError({"status": "Use COMPLETED, CANCELLED, or NO_SHOW for an interview action."})
    if instance.status == status:
        return instance
    if instance.status == Interview.Status.DRAFT and status == Interview.Status.CANCELLED:
        pass
    elif instance.status != Interview.Status.SCHEDULED:
        raise ValidationError({"status": "Only scheduled interviews can be completed, cancelled, or marked no-show."})
    instance.status = status
    instance.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action=f"recruitment.interview.{status.lower()}")
    record_user_activity(actor=actor, institution=instance.institution, activity_code="interview.update", entity=instance)
    return instance


@transaction.atomic
def record_evaluation(*, institution, application, interviewer, actor, **values):
    _active_member(actor, institution)
    if application.institution_id != institution.id or interviewer is None or not interviewer.memberships.filter(institution=institution, status="ACTIVE").exists():
        raise ValidationError({"application": "Application and interviewer must belong to the institution."})
    evaluation = CandidateEvaluation(institution=institution, application=application, interviewer=interviewer, **values)
    evaluation.full_clean()
    evaluation.save()
    record_audit_event(actor=actor, institution=institution, entity=evaluation, action="recruitment.evaluation.recorded", metadata={"application_id": str(application.id)})
    return evaluation


@transaction.atomic
def extend_offer(*, offer, actor):
    instance = Offer.objects.select_for_update().select_related("application__candidate", "application__job_posting").get(pk=offer.pk)
    _active_member(actor, instance.institution)
    if instance.status == Offer.Status.EXTENDED:
        return instance
    if instance.status not in (Offer.Status.DRAFT, Offer.Status.APPROVED):
        raise ValidationError({"status": "Only approved offers can be sent."})
    if instance.application.status != Application.Status.ACTIVE:
        raise ValidationError({"application": "Only active applications can receive an offer."})
    if instance.status == Offer.Status.DRAFT:
        # An approver may send a draft directly; that records their approval.
        if not _can(actor, instance.institution, "offer.approve"):
            raise ValidationError({"status": "Submit the offer for approval before sending it."})
        instance.approved_by = actor
        instance.approved_at = timezone.now()
    instance.status = Offer.Status.EXTENDED
    instance.extended_at = timezone.now()
    instance.save(update_fields=("status", "extended_at", "approved_by", "approved_at", "updated_at"))
    instance.application.status = Application.Status.OFFERED
    instance.application.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.extended")
    record_user_activity(actor=actor, institution=instance.institution, activity_code="offer.manage", entity=instance)
    _notify(instance.application.job_posting.hiring_manager, instance, "RECRUITMENT_OFFER_EXTENDED", "Offer extended", f"An offer was extended to {instance.application.candidate.full_name}.")
    return instance


@transaction.atomic
def decide_offer(*, offer, actor, accepted, note=""):
    instance = Offer.objects.select_for_update().select_related("application").get(pk=offer.pk)
    _active_member(actor, instance.institution)
    target = Offer.Status.ACCEPTED if accepted else Offer.Status.DECLINED
    if instance.status == target:
        return instance
    if instance.status != Offer.Status.EXTENDED:
        raise ValidationError({"status": "Only extended offers can be accepted or declined."})
    instance.status = target
    now = timezone.now()
    instance.response_note = (note or "").strip()
    instance.response_recorded_by = actor
    if accepted:
        instance.accepted_at = now
        fields = ("status", "accepted_at", "response_note", "response_recorded_by", "updated_at")
    else:
        instance.declined_at = now
        fields = ("status", "declined_at", "response_note", "response_recorded_by", "updated_at")
    instance.save(update_fields=fields)
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action=f"recruitment.offer.{target.lower()}", metadata={"note": instance.response_note})
    return instance


@transaction.atomic
def withdraw_offer(*, offer, actor):
    instance = Offer.objects.select_for_update().get(pk=offer.pk)
    _active_member(actor, instance.institution)
    if instance.status == Offer.Status.WITHDRAWN:
        return instance
    if instance.status not in (Offer.Status.DRAFT, Offer.Status.PENDING_APPROVAL, Offer.Status.APPROVED, Offer.Status.EXTENDED):
        raise ValidationError({"status": "Only offers that have not been decided can be withdrawn."})
    instance.status = Offer.Status.WITHDRAWN
    instance.save(update_fields=("status", "updated_at"))
    if instance.application.status == Application.Status.OFFERED:
        instance.application.status = Application.Status.ACTIVE
        instance.application.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.withdrawn")
    return instance


@transaction.atomic
def hire_candidate(*, offer, actor, employee_number=None, existing_employee=None):
    """Complete an accepted offer by creating or linking canonical HR records.

    ``existing_employee`` supports controlled historical recruitment imports and
    deterministic demo scenarios where an employee was seeded before the ATS
    history. It never rewrites the employee or current employment record.
    """
    instance = Offer.objects.select_for_update().select_related("application__candidate").get(pk=offer.pk)
    _active_member(actor, instance.institution)
    if instance.hired_employee_id:
        return instance.hired_employee
    if instance.status != Offer.Status.ACCEPTED:
        raise ValidationError({"status": "Only accepted offers can be hired."})
    candidate = Candidate.objects.select_for_update().get(pk=instance.application.candidate_id)
    if existing_employee is not None:
        employee = Employee.objects.select_for_update().get(pk=existing_employee.pk)
        if employee.institution_id != instance.institution_id:
            raise ValidationError({"existing_employee": "Employee belongs to another institution."})
        employment = Employment.objects.filter(employee=employee, is_current=True).first()
        if employment is None:
            raise ValidationError({"existing_employee": "Employee must have a current employment record."})
        EmployeeOnboarding.objects.get_or_create(
            institution=instance.institution,
            employee=employee,
            defaults={"status": EmployeeOnboarding.Status.NOT_STARTED, "notes": "Linked from accepted recruitment offer."},
        )
    else:
        employee = Employee(
            institution=instance.institution,
            employee_number=(employee_number or "").strip(),
            first_name=candidate.first_name,
            middle_name=candidate.middle_name,
            last_name=candidate.last_name,
            personal_email=candidate.email,
            phone=candidate.phone,
            hire_date=instance.proposed_start_date,
        )
        employee.full_clean()
        employee.save()
        employment = Employment(institution=instance.institution, employee=employee, department=instance.department, position=instance.position, grade=instance.grade, location=instance.location, employment_type=instance.employment_type, staff_category=instance.staff_category, start_date=instance.proposed_start_date, status=Employment.Status.ACTIVE, is_current=True)
        employment.full_clean()
        employment.save()
        EmployeeOnboarding.objects.create(
            institution=instance.institution,
            employee=employee,
            status=EmployeeOnboarding.Status.NOT_STARTED,
            notes="Created from accepted recruitment offer.",
        )
    if instance.salary_structure_id and existing_employee is None:
        compensation = EmployeeCompensation(institution=instance.institution, employee=employee, salary_structure=instance.salary_structure, base_salary=instance.base_salary, currency=instance.currency, effective_from=instance.proposed_start_date, is_current=True)
        compensation.full_clean()
        compensation.save()
    instance.hired_employee = employee
    instance.status = Offer.Status.HIRED
    instance.save(update_fields=("hired_employee", "status", "updated_at"))
    instance.application.status = Application.Status.HIRED
    instance.application.save(update_fields=("status", "updated_at"))
    candidate.status = Candidate.Status.HIRED
    candidate.save(update_fields=("status", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.hired", metadata={"employee_id": str(employee.id), "employment_id": str(employment.id)})
    record_user_activity(actor=actor, institution=instance.institution, activity_code="offer.manage", entity=instance)
    _notify(instance.application.job_posting.hiring_manager, instance, "RECRUITMENT_CANDIDATE_HIRED", "Candidate hired", f"{candidate.full_name} has been converted to employee {employee.employee_number}.")
    return employee


REQUISITION_REQUIRED_FIELDS = {
    "title": "Job title",
    "department_id": "Department",
    "location_id": "Location",
    "employment_type": "Employment type",
    "hiring_reason": "Hiring reason",
    "target_start_date": "Proposed start date",
    "hiring_manager_id": "Hiring manager",
    "responsibilities": "Key responsibilities",
    "qualifications_essential": "Required qualifications and experience",
}


@transaction.atomic
def submit_job_posting_for_approval(*, job_posting, actor):
    posting = JobPosting.objects.select_for_update().get(pk=job_posting.pk)
    _active_member(actor, posting.institution)
    if posting.status == JobPosting.Status.PENDING_APPROVAL:
        return posting
    if posting.status != JobPosting.Status.DRAFT:
        raise ValidationError({"status": "Only draft requisitions can be submitted for approval."})
    missing = {field.removesuffix("_id"): f"{label} is required before submitting." for field, label in REQUISITION_REQUIRED_FIELDS.items() if not getattr(posting, field)}
    if missing:
        raise ValidationError(missing)
    posting.status = JobPosting.Status.PENDING_APPROVAL
    posting.submitted_by = actor
    posting.submitted_at = timezone.now()
    posting.approval_note = ""
    posting.full_clean()
    posting.save(update_fields=("status", "submitted_by", "submitted_at", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action="recruitment.requisition.submitted")
    from apps.institutions.models import InstitutionMembership

    for membership in InstitutionMembership.objects.filter(
        institution=posting.institution, status="ACTIVE", role__permissions__code="job_posting.approve"
    ).exclude(user=actor).select_related("user").distinct():
        _notify(membership.user, posting, "RECRUITMENT_REQUISITION_APPROVAL", "Requisition awaiting approval", f"{posting.title} ({posting.code}) needs approval before it can be published.")
    return posting


@transaction.atomic
def approve_job_posting(*, job_posting, actor, comment=""):
    posting = JobPosting.objects.select_for_update().get(pk=job_posting.pk)
    if not _can(actor, posting.institution, "job_posting.approve"):
        raise ValidationError({"actor": "Only requisition approvers can approve."})
    if posting.status != JobPosting.Status.PENDING_APPROVAL:
        raise ValidationError({"status": "Only requisitions pending approval can be approved."})
    if posting.submitted_by_id == actor.id:
        raise ValidationError({"actor": "Requisitions must be approved by someone other than the submitter."})
    posting.status = JobPosting.Status.APPROVED
    posting.approved_by = actor
    posting.approved_at = timezone.now()
    posting.approval_note = comment or ""
    posting.save(update_fields=("status", "approved_by", "approved_at", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action="recruitment.requisition.approved", metadata={"comment": comment})
    _notify(posting.submitted_by, posting, "RECRUITMENT_REQUISITION_APPROVED", "Requisition approved", f"{posting.title} was approved and can be published.")
    return posting


@transaction.atomic
def return_job_posting(*, job_posting, actor, comment=""):
    posting = JobPosting.objects.select_for_update().get(pk=job_posting.pk)
    if not _can(actor, posting.institution, "job_posting.approve"):
        raise ValidationError({"actor": "Only requisition approvers can return requisitions."})
    if posting.status != JobPosting.Status.PENDING_APPROVAL:
        raise ValidationError({"status": "Only requisitions pending approval can be returned."})
    if not (comment or "").strip():
        raise ValidationError({"comment": "Explain what needs to change."})
    posting.status = JobPosting.Status.DRAFT
    posting.approval_note = comment.strip()
    posting.save(update_fields=("status", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action="recruitment.requisition.returned", metadata={"comment": comment})
    _notify(posting.submitted_by, posting, "RECRUITMENT_REQUISITION_RETURNED", "Requisition returned for changes", comment.strip())
    return posting


@transaction.atomic
def add_hiring_team_member(*, job_posting, actor, user, role):
    from apps.recruitment.models import JobPostingTeamMember

    _active_member(actor, job_posting.institution)
    if job_posting.status in {JobPosting.Status.CLOSED, JobPosting.Status.CANCELLED}:
        raise ValidationError({"job_posting": "Closed requisitions cannot change their hiring team."})
    member = JobPostingTeamMember(institution=job_posting.institution, job_posting=job_posting, user=user, role=role)
    member.full_clean()
    member.save()
    record_audit_event(actor=actor, institution=job_posting.institution, entity=job_posting, action="recruitment.requisition.team_added",
                       metadata={"user_id": str(user.id), "role": role})
    return member


@transaction.atomic
def remove_hiring_team_member(*, member, actor):
    _active_member(actor, member.institution)
    posting = member.job_posting
    metadata = {"user_id": str(member.user_id), "role": member.role}
    member.delete()
    record_audit_event(actor=actor, institution=posting.institution, entity=posting, action="recruitment.requisition.team_removed", metadata=metadata)


DEFAULT_COMPETENCIES = (
    ("Role expertise", "Depth of knowledge in the role's key discipline"),
    ("Problem solving", "Analysis, judgement and practical solutions"),
    ("Communication", "Clarity, written and verbal skills"),
    ("Collaboration", "Working across teams and communities"),
    ("Growth potential", "Track record and future potential"),
    ("Values and behaviours", "Alignment with the institution's values"),
)


def ensure_default_competencies(institution):
    """Institutions start with a generic competency set they can later edit."""
    from apps.recruitment.models import RecruitmentCompetency

    if not RecruitmentCompetency.objects.for_institution(institution).exists():
        RecruitmentCompetency.objects.bulk_create([
            RecruitmentCompetency(institution=institution, name=name, description=description, sequence=index)
            for index, (name, description) in enumerate(DEFAULT_COMPETENCIES, start=1)
        ], ignore_conflicts=True)
    return RecruitmentCompetency.objects.for_institution(institution).filter(is_active=True).order_by("sequence", "name")


def can_evaluate_application(*, application, user):
    """Recruitment panel: the requisition's hiring manager and hiring team, or
    anyone whose role records candidate evaluations."""
    posting = application.job_posting
    if posting.hiring_manager_id == user.id or posting.team_members.filter(user=user).exists():
        return True
    return _can(user, application.institution, "candidate_evaluation.create")


def application_scorecard(*, application, user):
    from apps.recruitment.models import CompetencyRating

    competencies = list(ensure_default_competencies(application.institution))
    ratings = CompetencyRating.objects.filter(application=application).select_related("evaluator")
    mine = {str(row.competency_id): row for row in ratings if row.evaluator_id == user.id}
    submitted_rows = [row for row in ratings if row.submitted_at]
    evaluators = {row.evaluator_id for row in submitted_rows}
    my_submitted = any(row.submitted_at for row in mine.values())
    summary = []
    for competency in competencies:
        counts = {}
        for row in submitted_rows:
            if row.competency_id == competency.id and row.rating != CompetencyRating.Rating.NOT_ASSESSED:
                counts[row.rating] = counts.get(row.rating, 0) + 1
        summary.append({"competency": str(competency.id), "counts": counts})
    return {
        "competencies": [{"id": str(item.id), "name": item.name, "description": item.description} for item in competencies],
        "mine": {key: {"rating": row.rating, "comment": row.comment} for key, row in mine.items()},
        "my_submitted_at": max((row.submitted_at for row in mine.values() if row.submitted_at), default=None),
        "can_evaluate": can_evaluate_application(application=application, user=user),
        "locked": my_submitted,
        "evaluator_count": len(evaluators),
        # Individual panel scores stay private; the panel sees aggregates only.
        "summary": summary if (my_submitted or not can_evaluate_application(application=application, user=user)) else [],
    }


@transaction.atomic
def save_application_scorecard(*, application, actor, ratings, submit=False):
    from apps.recruitment.models import CompetencyRating

    if not can_evaluate_application(application=application, user=actor):
        raise ValidationError({"actor": "Only members of the recruitment panel can evaluate this candidate."})
    if application.status not in (Application.Status.ACTIVE, Application.Status.OFFERED):
        raise ValidationError({"status": "Only active applications can be evaluated."})
    existing = CompetencyRating.objects.select_for_update().filter(application=application, evaluator=actor)
    if existing.filter(submitted_at__isnull=False).exists():
        raise ValidationError({"scorecard": "Your evaluation has already been submitted."})
    competencies = {str(item.id): item for item in ensure_default_competencies(application.institution)}
    for entry in ratings:
        competency = competencies.get(str(entry.get("competency")))
        if competency is None:
            raise ValidationError({"ratings": "Unknown competency."})
        row, _ = CompetencyRating.objects.get_or_create(
            application=application, competency=competency, evaluator=actor,
            defaults={"institution": application.institution},
        )
        row.rating = entry.get("rating") or CompetencyRating.Rating.NOT_ASSESSED
        row.comment = (entry.get("comment") or "").strip()
        row.full_clean()
        row.save()
    if submit:
        rows = CompetencyRating.objects.filter(application=application, evaluator=actor)
        assessed = rows.exclude(rating=CompetencyRating.Rating.NOT_ASSESSED).count()
        if assessed < len(competencies):
            raise ValidationError({"ratings": "Assess every competency before submitting your evaluation."})
        rows.update(submitted_at=timezone.now())
        record_audit_event(actor=actor, institution=application.institution, entity=application, action="recruitment.application.scorecard_submitted")
    return application_scorecard(application=application, user=actor)


CANDIDATE_DOCUMENT_CATEGORIES = ("CV", "COVER_LETTER", "CERTIFICATE", "PORTFOLIO", "REFERENCE", "OTHER")


@transaction.atomic
def attach_candidate_document(*, candidate, actor, uploaded_file, category):
    from django.conf import settings as django_settings
    import mimetypes

    from apps.documents.models import Document

    _active_member(actor, candidate.institution)
    if category not in CANDIDATE_DOCUMENT_CATEGORIES:
        raise ValidationError({"category": "Choose a valid document type."})
    if uploaded_file is None:
        raise ValidationError({"uploaded_file": "Choose a file to upload."})
    if uploaded_file.size > django_settings.DOCUMENT_UPLOAD_MAX_BYTES:
        raise ValidationError({"uploaded_file": f"Documents must be {django_settings.DOCUMENT_UPLOAD_MAX_BYTES // (1024 * 1024)} MB or smaller."})
    name = (uploaded_file.name or "document").replace("\\", "/").rsplit("/", 1)[-1][:255] or "document"
    content_type = (uploaded_file.content_type or "").lower().split(";")[0].strip()
    if not content_type or content_type == "application/octet-stream":
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    document = Document.objects.create(
        institution=candidate.institution, uploaded_by=actor, stored_file=uploaded_file, original_filename=name,
        content_type=content_type[:150], size_bytes=uploaded_file.size, category=category,
        classification=Document.Classification.CONFIDENTIAL, entity_type="recruitment.Candidate", entity_id=candidate.id,
    )
    record_audit_event(actor=actor, institution=candidate.institution, entity=candidate, action="recruitment.candidate.document_added",
                       metadata={"document_id": str(document.id), "category": category, "filename": name})
    return document


@transaction.atomic
def remove_candidate_document(*, candidate, document, actor):
    _active_member(actor, candidate.institution)
    document.is_active = False
    document.save(update_fields=("is_active", "updated_at"))
    record_audit_event(actor=actor, institution=candidate.institution, entity=candidate, action="recruitment.candidate.document_removed",
                       metadata={"document_id": str(document.id), "filename": document.original_filename})


# --- Interview scheduling (concept "Interview scheduling") -----------------

SLOT_HOURS = range(9, 18)


def _zone(name):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationError({"time_zone": "Use an IANA time zone such as Africa/Accra."})


def _busy_interviews(institution, user_ids, start, end, exclude_id=None):
    from django.db.models import Q

    candidates = Interview.objects.for_institution(institution).filter(
        status=Interview.Status.SCHEDULED, scheduled_at__lt=end, scheduled_at__gte=start - timedelta(hours=12),
    ).filter(Q(interviewer_id__in=user_ids) | Q(panel__in=user_ids)).distinct()
    if exclude_id:
        candidates = candidates.exclude(pk=exclude_id)
    return [item for item in candidates if item.scheduled_at + timedelta(minutes=item.duration_minutes) > start]


def _users_on_leave(institution, user_ids, day):
    from apps.leave.models import LeaveRequest

    return set(
        LeaveRequest.objects.filter(
            institution=institution, status="APPROVED", start_date__lte=day, end_date__gte=day, employee__user_id__in=user_ids,
        ).values_list("employee__user_id", flat=True)
    )


def interview_availability(*, institution, day, interviewer_ids, duration_minutes=60, time_zone="UTC", exclude_interview=None):
    """Hourly slots for one day: available, conflict (a panel member is already
    interviewing) or unavailable (in the past, or a panel member is on approved leave)."""
    from datetime import datetime, time

    zone = _zone(time_zone)
    ids = [value for value in interviewer_ids if value]
    on_leave = _users_on_leave(institution, ids, day) if ids else set()
    now = timezone.now()
    slots = []
    for hour in SLOT_HOURS:
        start = datetime.combine(day, time(hour, 0), tzinfo=zone)
        end = start + timedelta(minutes=duration_minutes)
        if start <= now:
            state, reason = "unavailable", "In the past"
        elif on_leave:
            state, reason = "unavailable", "A panel member is on approved leave"
        else:
            busy = _busy_interviews(institution, ids, start, end, exclude_interview) if ids else []
            state, reason = ("conflict", "A panel member has another interview") if busy else ("available", "")
        slots.append({"time": f"{hour:02d}:00", "start": start.isoformat(), "state": state, "reason": reason})
    return {"date": day.isoformat(), "time_zone": str(zone), "slots": slots}


def default_candidate_message(*, interview):
    candidate = interview.application.candidate
    posting = interview.application.job_posting
    zone = _zone(interview.time_zone)
    local = interview.scheduled_at.astimezone(zone)
    end = local + timedelta(minutes=interview.duration_minutes)
    names = ", ".join((user.get_full_name() or user.email) for user in interview.panel.all()) or "the hiring team"
    stage = interview.get_interview_stage_display().lower() if interview.interview_stage else "interview"
    where = {"VIDEO": "Video call (link will be sent)", "PHONE": "Phone call", "IN_PERSON": "In person"}.get(interview.mode, "")
    if interview.location_or_link:
        where = f"{where}: {interview.location_or_link}" if where else interview.location_or_link
    return (
        f"Hi {candidate.first_name},\n\n"
        f"You're invited to a {stage} for the {posting.title} role at {interview.institution.name}.\n\n"
        f"Date: {local:%A, %d %b %Y}\n"
        f"Time: {local:%H:%M} – {end:%H:%M} ({zone})\n"
        + (f"Where: {where}\n" if where else "")
        + f"Interviewers: {names}\n\n"
        "We look forward to speaking with you.\n"
        f"The {interview.institution.name} Recruitment Team"
    )


def _send_candidate_invitation(interview):
    from django.conf import settings as django_settings
    from django.core.mail import send_mail

    candidate = interview.application.candidate
    subject = f"Interview invitation – {interview.application.job_posting.title}"
    if not getattr(django_settings, "EMAIL_HOST", "") and "smtp" in getattr(django_settings, "EMAIL_BACKEND", "smtp"):
        return "NOT_CONFIGURED"
    try:
        send_mail(subject, interview.candidate_message, django_settings.DEFAULT_FROM_EMAIL, [candidate.email], fail_silently=False)
        return "SENT"
    except Exception:  # noqa: BLE001 - delivery failure is recorded, not fatal
        return "FAILED"


@transaction.atomic
def schedule_interview(*, application, actor, scheduled_at, duration_minutes, interview_stage, mode, time_zone, location_or_link="",
                       agenda="", panel=(), candidate_message="", draft=False, send_invitation=True, interview=None):
    """Create or update an interview. Drafts keep the details without holding
    the panel's time; scheduling checks leave and clashes for every panel member."""
    _active_member(actor, application.institution)
    if application.status not in (Application.Status.ACTIVE, Application.Status.OFFERED):
        raise ValidationError({"application": "Interviews can only be scheduled for active applications."})
    panel = [user for user in panel if user is not None]
    for user in panel:
        if not user.memberships.filter(institution=application.institution, status="ACTIVE").exists():
            raise ValidationError({"panel": "Interviewers must be active institution members."})
    was_scheduled = interview is not None and interview.status == Interview.Status.SCHEDULED
    if interview is None:
        interview = Interview(institution=application.institution, application=application)
    elif interview.status not in (Interview.Status.DRAFT, Interview.Status.SCHEDULED):
        raise ValidationError({"status": "Completed or cancelled interviews cannot be rescheduled."})
    interview.scheduled_at = scheduled_at
    interview.duration_minutes = duration_minutes
    interview.interview_stage = interview_stage
    interview.interview_type = dict(Interview.Stage.choices).get(interview_stage, interview.interview_type or "Interview")
    interview.mode = mode
    interview.time_zone = time_zone
    interview.location_or_link = location_or_link
    interview.agenda = agenda
    interview.interviewer = panel[0] if panel else None
    interview.status = Interview.Status.DRAFT if draft else Interview.Status.SCHEDULED
    if not draft:
        if scheduled_at <= timezone.now():
            raise ValidationError({"scheduled_at": "Choose a time in the future."})
        if not panel:
            raise ValidationError({"panel": "Add at least one interviewer."})
        ids = [user.id for user in panel]
        if _users_on_leave(application.institution, ids, scheduled_at.astimezone(_zone(time_zone)).date()):
            raise ValidationError({"scheduled_at": "A panel member is on approved leave that day."})
        end = scheduled_at + timedelta(minutes=duration_minutes)
        if _busy_interviews(application.institution, ids, scheduled_at, end, interview.pk):
            raise ValidationError({"scheduled_at": "A panel member already has an interview at this time."})
    interview.full_clean()
    interview.save()
    interview.panel.set(panel)
    interview.candidate_message = candidate_message.strip() or default_candidate_message(interview=interview)
    fields = ["candidate_message", "updated_at"]
    if not draft and send_invitation:
        interview.invitation_status = _send_candidate_invitation(interview)
        interview.invitation_sent_at = timezone.now() if interview.invitation_status == "SENT" else None
        fields += ["invitation_status", "invitation_sent_at"]
    interview.save(update_fields=fields)
    action = "recruitment.interview.drafted" if draft else ("recruitment.interview.rescheduled" if was_scheduled else "recruitment.interview.scheduled")
    record_audit_event(actor=actor, institution=application.institution, entity=interview, action=action,
                       metadata={"application_id": str(application.id), "scheduled_at": scheduled_at.isoformat(), "invitation": interview.invitation_status})
    if not draft:
        for user in panel:
            _notify(user, interview, "RECRUITMENT_INTERVIEW_SCHEDULED", "Interview scheduled",
                    f"{application.candidate.full_name} · {application.job_posting.title} on {scheduled_at.astimezone(_zone(time_zone)):%d %b %Y %H:%M}.")
    return interview


# --- Offer approval and letter (concept "Offer management") -----------------

@transaction.atomic
def submit_offer_for_approval(*, offer, actor):
    instance = Offer.objects.select_for_update().get(pk=offer.pk)
    _active_member(actor, instance.institution)
    if instance.status == Offer.Status.PENDING_APPROVAL:
        return instance
    if instance.status != Offer.Status.DRAFT:
        raise ValidationError({"status": "Only draft offers can be submitted for approval."})
    if instance.base_salary is None:
        raise ValidationError({"base_salary": "Add compensation before submitting the offer for approval."})
    instance.status = Offer.Status.PENDING_APPROVAL
    instance.submitted_by = actor
    instance.submitted_at = timezone.now()
    instance.approval_note = ""
    instance.save(update_fields=("status", "submitted_by", "submitted_at", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.submitted")
    from apps.institutions.models import InstitutionMembership

    for membership in InstitutionMembership.objects.filter(
        institution=instance.institution, status="ACTIVE", role__permissions__code="offer.approve"
    ).exclude(user=actor).select_related("user").distinct():
        _notify(membership.user, instance, "RECRUITMENT_OFFER_APPROVAL", "Offer awaiting approval", f"An offer for {instance.application.candidate.full_name} needs approval.")
    return instance


@transaction.atomic
def approve_offer(*, offer, actor, comment=""):
    instance = Offer.objects.select_for_update().get(pk=offer.pk)
    if not _can(actor, instance.institution, "offer.approve"):
        raise ValidationError({"actor": "Only offer approvers can approve."})
    if instance.status != Offer.Status.PENDING_APPROVAL:
        raise ValidationError({"status": "Only offers pending approval can be approved."})
    if instance.submitted_by_id == actor.id:
        raise ValidationError({"actor": "Offers must be approved by someone other than the submitter."})
    instance.status = Offer.Status.APPROVED
    instance.approved_by = actor
    instance.approved_at = timezone.now()
    instance.approval_note = (comment or "").strip()
    instance.save(update_fields=("status", "approved_by", "approved_at", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.approved", metadata={"comment": instance.approval_note})
    _notify(instance.submitted_by, instance, "RECRUITMENT_OFFER_APPROVED", "Offer approved", f"The offer for {instance.application.candidate.full_name} was approved and can be sent.")
    return instance


@transaction.atomic
def return_offer(*, offer, actor, comment=""):
    instance = Offer.objects.select_for_update().get(pk=offer.pk)
    if not _can(actor, instance.institution, "offer.approve"):
        raise ValidationError({"actor": "Only offer approvers can return offers."})
    if instance.status != Offer.Status.PENDING_APPROVAL:
        raise ValidationError({"status": "Only offers pending approval can be returned."})
    if not (comment or "").strip():
        raise ValidationError({"comment": "Explain what needs to change."})
    instance.status = Offer.Status.DRAFT
    instance.approval_note = comment.strip()
    instance.save(update_fields=("status", "approval_note", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.returned", metadata={"comment": instance.approval_note})
    _notify(instance.submitted_by, instance, "RECRUITMENT_OFFER_RETURNED", "Offer returned for changes", instance.approval_note)
    return instance


def _money(amount, currency):
    return f"{currency} {amount:,.2f}" if amount is not None else "to be confirmed"


@transaction.atomic
def generate_offer_letter(*, offer, actor):
    # Lock only the offer row: Postgres rejects FOR UPDATE across the nullable reports_to join.
    instance = Offer.objects.select_for_update(of=("self",)).select_related(
        "application__candidate", "application__job_posting", "position", "department", "location", "grade", "reports_to", "institution"
    ).get(pk=offer.pk)
    _active_member(actor, instance.institution)
    if instance.status not in (Offer.Status.DRAFT, Offer.Status.APPROVED):
        raise ValidationError({"status": "The letter can only be regenerated while the offer is a draft or approved."})
    candidate = instance.application.candidate
    lines = [
        f"{timezone.localdate():%d %B %Y}",
        "",
        f"Dear {candidate.first_name} {candidate.last_name},",
        "",
        f"Offer of employment: {instance.position.title}",
        "",
        f"We are pleased to offer you the position of {instance.position.title} in {instance.department.name} at "
        f"{instance.institution.name}, based at {instance.location.name}.",
        "",
        "Terms of the offer:",
        f"- Employment type: {instance.get_employment_type_display()}",
    ]
    if instance.contract_length_months:
        lines.append(f"- Contract length: {instance.contract_length_months} months")
    if instance.working_pattern:
        lines.append(f"- Working pattern: {instance.get_working_pattern_display()}")
    lines += [
        f"- Grade: {instance.grade.name}",
        f"- Salary: {_money(instance.base_salary, instance.currency)} per month",
        f"- Start date: {instance.proposed_start_date:%d %B %Y}",
    ]
    if instance.reports_to_id:
        lines.append(f"- Reporting to: {instance.reports_to.title}")
    if instance.terms.strip():
        lines += ["", instance.terms.strip()]
    if instance.expires_on:
        lines += ["", f"Please confirm your acceptance by {instance.expires_on:%d %B %Y}."]
    lines += ["", "We look forward to welcoming you.", "", "Yours sincerely,", "", f"{instance.institution.name} Recruitment Team"]
    instance.letter_body = "\n".join(lines)
    instance.letter_generated_at = timezone.now()
    instance.save(update_fields=("letter_body", "letter_generated_at", "updated_at"))
    record_audit_event(actor=actor, institution=instance.institution, entity=instance, action="recruitment.offer.letter_generated")
    return instance
