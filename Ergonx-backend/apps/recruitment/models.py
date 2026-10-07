from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from apps.compensation.models import SalaryStructure
from apps.employees.models import Employee, Employment
from apps.institutions.models import Institution
from apps.organization.models import Department, Grade, Location, Position
from common.codes import AutoCodeMixin
from common.models import TenantOwnedModel


class JobPosting(AutoCodeMixin, TenantOwnedModel):
    auto_code_prefix = "JOB"
    auto_code_width = 5
    auto_code_year_from = "today"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"
        CANCELLED = "CANCELLED", "Cancelled"

    class HiringReason(models.TextChoices):
        NEW_ROLE = "NEW_ROLE", "New role"
        REPLACEMENT = "REPLACEMENT", "Replacement"
        EXPANSION = "EXPANSION", "Team expansion"
        TEMPORARY_COVER = "TEMPORARY_COVER", "Temporary cover"

    class InterviewPlan(models.TextChoices):
        SINGLE_PANEL = "SINGLE_PANEL", "Single panel interview"
        TWO_STAGE = "TWO_STAGE", "Screening + panel interview"
        TECHNICAL_PANEL = "TECHNICAL_PANEL", "Technical assessment + panel"
        PRESENTATION_PANEL = "PRESENTATION_PANEL", "Presentation + panel"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="job_postings")
    code = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=200)
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="job_postings")
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="job_postings")
    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="job_postings")
    hiring_manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="managed_job_postings")
    description = models.TextField(blank=True)
    employment_type = models.CharField(max_length=12, choices=Employment.EmploymentType.choices)
    openings = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    opens_on = models.DateField(null=True, blank=True)
    closes_on = models.DateField(null=True, blank=True)
    # Requisition / hiring plan
    hiring_reason = models.CharField(max_length=16, choices=HiringReason.choices, blank=True)
    grade = models.ForeignKey("organization.Grade", null=True, blank=True, on_delete=models.PROTECT, related_name="job_postings")
    reports_to = models.ForeignKey(Position, null=True, blank=True, on_delete=models.PROTECT, related_name="reporting_job_postings")
    target_start_date = models.DateField(null=True, blank=True)
    salary_currency = models.CharField(max_length=3, blank=True)
    salary_min = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    salary_max = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    interview_plan = models.CharField(max_length=20, choices=InterviewPlan.choices, blank=True)
    responsibilities = models.TextField(blank=True, max_length=4000)
    qualifications_essential = models.TextField(blank=True, max_length=4000)
    qualifications_desirable = models.TextField(blank=True, max_length=4000)
    # Approval
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="submitted_job_postings")
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="approved_job_postings")
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=("institution", "code"), name="uniq_job_posting_code_per_institution"),
            models.CheckConstraint(condition=Q(openings__gt=0), name="job_posting_openings_positive"),
            models.CheckConstraint(condition=Q(closes_on__isnull=True) | Q(opens_on__isnull=True) | Q(closes_on__gte=models.F("opens_on")), name="job_posting_dates_valid"),
        ]
        indexes = [models.Index(fields=("institution", "status")), models.Index(fields=("institution", "department"))]

    def clean(self):
        self.code = self.code.strip().upper()
        errors = {}
        for name in ("department", "position", "location"):
            obj = getattr(self, name, None)
            if obj and obj.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.position_id and self.department_id and self.position.department_id != self.department_id:
            errors["position"] = "Position must belong to the selected department."
        if self.hiring_manager_id and not self.hiring_manager.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
            errors["hiring_manager"] = "Hiring manager must be an active institution member."
        if self.closes_on and self.opens_on and self.closes_on < self.opens_on:
            errors["closes_on"] = "Closing date cannot precede opening date."
        for name in ("grade", "reports_to"):
            obj = getattr(self, name, None)
            if obj and obj.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.salary_min is not None and self.salary_max is not None and self.salary_max < self.salary_min:
            errors["salary_max"] = "Maximum salary cannot be below the minimum."
        if (self.salary_min is not None or self.salary_max is not None) and len((self.salary_currency or "").strip()) != 3:
            errors["salary_currency"] = "Use a three-letter currency code with a salary range."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        self.salary_currency = (self.salary_currency or "").strip().upper()
        super().save(*args, **kwargs)


class JobPostingTeamMember(TenantOwnedModel):
    """People involved in hiring for a requisition."""

    class Role(models.TextChoices):
        HIRING_MANAGER = "HIRING_MANAGER", "Hiring manager"
        INTERVIEW_PANEL = "INTERVIEW_PANEL", "Interview panel"
        HR_PARTNER = "HR_PARTNER", "HR business partner"
        COORDINATOR = "COORDINATOR", "Recruitment coordinator"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="job_posting_team_members")
    job_posting = models.ForeignKey(JobPosting, on_delete=models.CASCADE, related_name="team_members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="hiring_team_memberships")
    role = models.CharField(max_length=16, choices=Role.choices)

    class Meta:
        ordering = ("job_posting", "role", "created_at")
        constraints = [models.UniqueConstraint(fields=("job_posting", "user"), name="uniq_hiring_team_member_per_posting")]

    def clean(self):
        errors = {}
        if self.job_posting_id and self.job_posting.institution_id != self.institution_id:
            errors["job_posting"] = "Requisition belongs to another institution."
        if self.user_id and not self.user.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
            errors["user"] = "Team members must be active institution members."
        if errors:
            raise ValidationError(errors)


class Candidate(TenantOwnedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        HIRED = "HIRED", "Hired"

    class EmploymentStatus(models.TextChoices):
        EMPLOYED = "EMPLOYED", "Employed"
        SELF_EMPLOYED = "SELF_EMPLOYED", "Self-employed"
        UNEMPLOYED = "UNEMPLOYED", "Not currently employed"
        STUDENT = "STUDENT", "Student or graduate"
        OTHER = "OTHER", "Other"

    class Qualification(models.TextChoices):
        SECONDARY = "SECONDARY", "Secondary school"
        DIPLOMA = "DIPLOMA", "Diploma or certificate"
        BACHELORS = "BACHELORS", "Bachelor's degree"
        MASTERS = "MASTERS", "Master's degree"
        DOCTORATE = "DOCTORATE", "Doctorate"
        PROFESSIONAL = "PROFESSIONAL", "Professional qualification"
        OTHER = "OTHER", "Other"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="candidates")
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100)
    email = models.EmailField()
    phone = models.CharField(max_length=30, blank=True)
    source = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)
    # Application profile (concept "Candidate application submission").
    location = models.CharField(max_length=150, blank=True)
    employment_status = models.CharField(max_length=16, choices=EmploymentStatus.choices, blank=True)
    linkedin_url = models.URLField(blank=True)
    current_employer = models.CharField(max_length=200, blank=True)
    current_title = models.CharField(max_length=200, blank=True)
    years_experience = models.PositiveSmallIntegerField(null=True, blank=True)
    highest_qualification = models.CharField(max_length=16, choices=Qualification.choices, blank=True)
    field_of_study = models.CharField(max_length=200, blank=True)
    education_institution = models.CharField(max_length=200, blank=True)
    skills = models.TextField(blank=True, max_length=2000)
    notice_period_weeks = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ("last_name", "first_name", "created_at")
        constraints = [models.UniqueConstraint(fields=("institution", "email"), name="uniq_candidate_email_per_institution")]
        indexes = [models.Index(fields=("institution", "status")), models.Index(fields=("institution", "last_name"))]

    @property
    def full_name(self):
        return " ".join(part for part in (self.first_name, self.middle_name, self.last_name) if part)


class RecruitmentStage(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="recruitment_stages")
    name = models.CharField(max_length=100)
    sequence = models.PositiveSmallIntegerField()
    is_terminal = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("sequence", "created_at")
        constraints = [
            models.UniqueConstraint(fields=("institution", "name"), name="uniq_recruitment_stage_name_per_institution"),
            models.UniqueConstraint(fields=("institution", "sequence"), name="uniq_recruitment_stage_sequence_per_institution"),
        ]
        indexes = [models.Index(fields=("institution", "is_active"))]


class Application(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        REJECTED = "REJECTED", "Rejected"
        OFFERED = "OFFERED", "Offered"
        HIRED = "HIRED", "Hired"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="applications")
    job_posting = models.ForeignKey(JobPosting, on_delete=models.PROTECT, related_name="applications")
    candidate = models.ForeignKey(Candidate, on_delete=models.PROTECT, related_name="applications")
    current_stage = models.ForeignKey(RecruitmentStage, null=True, blank=True, on_delete=models.PROTECT, related_name="applications")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    applied_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("-applied_at", "-created_at")
        constraints = [models.UniqueConstraint(fields=("job_posting", "candidate"), name="uniq_candidate_application_per_job")]
        indexes = [models.Index(fields=("institution", "status")), models.Index(fields=("institution", "job_posting", "current_stage"))]

    def clean(self):
        errors = {}
        for name in ("job_posting", "candidate", "current_stage"):
            obj = getattr(self, name, None)
            if obj and obj.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if errors:
            raise ValidationError(errors)


class ApplicationStageHistory(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="application_stage_history")
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="stage_history")
    from_stage = models.ForeignKey(RecruitmentStage, null=True, blank=True, on_delete=models.PROTECT, related_name="stage_departures")
    to_stage = models.ForeignKey(RecruitmentStage, on_delete=models.PROTECT, related_name="stage_arrivals")
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="recruitment_stage_changes")
    comment = models.TextField(blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("institution", "application"))]


class Interview(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SCHEDULED = "SCHEDULED", "Scheduled"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        NO_SHOW = "NO_SHOW", "No show"

    class Stage(models.TextChoices):
        SCREENING = "SCREENING", "Screening call"
        FIRST_ROUND = "FIRST_ROUND", "First round interview"
        SECOND_ROUND = "SECOND_ROUND", "Second round interview"
        TECHNICAL = "TECHNICAL", "Technical assessment"
        FINAL = "FINAL", "Final interview"

    class Mode(models.TextChoices):
        VIDEO = "VIDEO", "Video call"
        PHONE = "PHONE", "Phone call"
        IN_PERSON = "IN_PERSON", "In person"
        OTHER = "OTHER", "Other"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="interviews")
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="interviews")
    scheduled_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=60)
    interview_type = models.CharField(max_length=100, blank=True)
    location_or_link = models.CharField(max_length=500, blank=True)
    interviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="recruitment_interviews")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    notes = models.TextField(blank=True)
    interview_stage = models.CharField(max_length=16, choices=Stage.choices, blank=True)
    mode = models.CharField(max_length=12, choices=Mode.choices, blank=True)
    time_zone = models.CharField(max_length=64, blank=True)
    agenda = models.TextField(blank=True, max_length=500)
    panel = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="interview_panels")
    candidate_message = models.TextField(blank=True, max_length=4000)
    invitation_sent_at = models.DateTimeField(null=True, blank=True)
    invitation_status = models.CharField(max_length=16, blank=True)

    class Meta:
        ordering = ("scheduled_at",)
        constraints = [models.CheckConstraint(condition=Q(duration_minutes__gt=0), name="interview_duration_positive")]
        indexes = [models.Index(fields=("institution", "status", "scheduled_at")), models.Index(fields=("institution", "application"))]

    def clean(self):
        errors = {}
        if self.application_id and self.application.institution_id != self.institution_id:
            errors["application"] = "Application must belong to the same institution."
        if self.interviewer_id and not self.interviewer.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
            errors["interviewer"] = "Interviewer must be an active institution member."
        if self.time_zone:
            from zoneinfo import available_timezones

            if self.time_zone not in available_timezones():
                errors["time_zone"] = "Use an IANA time zone such as Africa/Accra."
        if errors:
            raise ValidationError(errors)


class CandidateEvaluation(TenantOwnedModel):
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="evaluations")
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="candidate_evaluations")
    interviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="candidate_evaluations")
    interview = models.ForeignKey(Interview, null=True, blank=True, on_delete=models.SET_NULL, related_name="evaluations")
    score = models.DecimalField(max_digits=5, decimal_places=2)
    recommendation = models.CharField(max_length=20, choices=(("STRONG_YES", "Strong yes"), ("YES", "Yes"), ("NO", "No"), ("STRONG_NO", "Strong no")))
    comments = models.TextField(blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.CheckConstraint(condition=Q(score__gte=0) & Q(score__lte=100), name="candidate_evaluation_score_range")]
        indexes = [models.Index(fields=("institution", "application"))]

    def clean(self):
        errors = {}
        if self.application_id and self.application.institution_id != self.institution_id:
            errors["application"] = "Application must belong to the same institution."
        if self.interview_id and self.interview.application_id != self.application_id:
            errors["interview"] = "Interview must belong to the selected application."
        if self.interviewer_id and not self.interviewer.memberships.filter(institution_id=self.institution_id, status="ACTIVE").exists():
            errors["interviewer"] = "Interviewer must be an active institution member."
        if errors:
            raise ValidationError(errors)


class Offer(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        EXTENDED = "EXTENDED", "Sent"
        ACCEPTED = "ACCEPTED", "Accepted"
        DECLINED = "DECLINED", "Declined"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"
        HIRED = "HIRED", "Hired"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="offers")
    application = models.OneToOneField(Application, on_delete=models.PROTECT, related_name="offer")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    proposed_start_date = models.DateField()
    expires_on = models.DateField(null=True, blank=True)
    employment_type = models.CharField(max_length=12, choices=Employment.EmploymentType.choices)
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="recruitment_offers")
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="recruitment_offers")
    grade = models.ForeignKey(Grade, on_delete=models.PROTECT, related_name="recruitment_offers")
    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="recruitment_offers")
    staff_category = models.CharField(max_length=10, choices=Employment.StaffCategory.choices, default=Employment.StaffCategory.OTHER)
    salary_structure = models.ForeignKey(SalaryStructure, null=True, blank=True, on_delete=models.PROTECT, related_name="recruitment_offers")
    base_salary = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True)
    extended_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    hired_employee = models.OneToOneField(Employee, null=True, blank=True, on_delete=models.PROTECT, related_name="recruitment_offer")
    terms = models.TextField(blank=True)
    contract_length_months = models.PositiveSmallIntegerField(null=True, blank=True)
    working_pattern = models.CharField(max_length=12, choices=Employment.WorkingPattern.choices, blank=True)
    reports_to = models.ForeignKey(Position, null=True, blank=True, on_delete=models.PROTECT, related_name="recruitment_offers_reporting")
    letter_body = models.TextField(blank=True, max_length=20000)
    letter_generated_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="submitted_recruitment_offers")
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="approved_recruitment_offers")
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_note = models.TextField(blank=True)
    response_note = models.TextField(blank=True)
    response_recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="recorded_offer_responses")

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.CheckConstraint(condition=Q(base_salary__isnull=True) | Q(base_salary__gte=0), name="offer_salary_nonnegative")]
        indexes = [models.Index(fields=("institution", "status"))]

    def clean(self):
        self.currency = self.currency.strip().upper()
        errors = {}
        for name in ("application", "department", "position", "grade", "location", "salary_structure", "hired_employee", "reports_to"):
            obj = getattr(self, name, None)
            if obj and obj.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.position_id and self.department_id and self.position.department_id != self.department_id:
            errors["position"] = "Position must belong to the selected department."
        if (self.base_salary is None) != (self.salary_structure_id is None):
            errors["base_salary"] = "Base salary and salary structure must be supplied together."
        if self.salary_structure_id and (len(self.currency) != 3 or not self.currency.isalpha()):
            errors["currency"] = "Use a three-letter ISO currency code when compensation is offered."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.currency = self.currency.strip().upper()
        super().save(*args, **kwargs)


class RecruitmentCompetency(TenantOwnedModel):
    """Criteria the recruitment panel scores candidates against."""

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="recruitment_competencies")
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=255, blank=True)
    sequence = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("sequence", "name")
        constraints = [models.UniqueConstraint(fields=("institution", "name"), name="uniq_recruitment_competency_name")]


class CompetencyRating(TenantOwnedModel):
    """One evaluator's assessment of one competency for one application."""

    class Rating(models.TextChoices):
        NOT_ASSESSED = "NOT_ASSESSED", "Not yet assessed"
        DOES_NOT_MEET = "DOES_NOT_MEET", "Does not meet"
        PARTIALLY_MEETS = "PARTIALLY_MEETS", "Partially meets"
        MEETS = "MEETS", "Meets"
        EXCEEDS = "EXCEEDS", "Exceeds"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="competency_ratings")
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="competency_ratings")
    competency = models.ForeignKey(RecruitmentCompetency, on_delete=models.PROTECT, related_name="ratings")
    evaluator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="competency_ratings")
    rating = models.CharField(max_length=16, choices=Rating.choices, default=Rating.NOT_ASSESSED)
    comment = models.TextField(blank=True, max_length=2000)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("competency__sequence",)
        constraints = [models.UniqueConstraint(fields=("application", "competency", "evaluator"), name="uniq_competency_rating_per_evaluator")]
        indexes = [models.Index(fields=("institution", "application"))]
