"""Performance reviews (ErgonX HR).

HR runs a ``ReviewCycle`` over a set of competencies. Launching the cycle opens
one ``PerformanceReview`` per participant, which moves through:

    SELF_ASSESSMENT -> MANAGER_REVIEW -> HR_REVIEW -> COMPLETED

The employee rates themselves first, their reviewer (manager) rates each
competency and gives an overall rating, and HR signs the review off or returns
it to the reviewer. Ratings are on a 1-5 scale.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.employees.models import Employee
from apps.institutions.models import Institution
from common.models import TenantOwnedModel

RATING_VALIDATORS = (MinValueValidator(1), MaxValueValidator(5))
RATING_LABELS = {1: "Unsatisfactory", 2: "Needs improvement", 3: "Meets expectations", 4: "Exceeds expectations", 5: "Outstanding"}


class Competency(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="performance_competencies")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("sort_order", "name")
        constraints = [models.UniqueConstraint(fields=("institution", "name"), name="uniq_performance_competency_name")]

    def clean(self):
        self.name = (self.name or "").strip()
        if not self.name:
            raise ValidationError({"name": "Name the competency."})

    def __str__(self):
        return self.name


class ReviewCycle(TenantOwnedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "In progress"
        CLOSED = "CLOSED", "Closed"

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="review_cycles")
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    period_start = models.DateField()
    period_end = models.DateField()
    self_assessment_due = models.DateField(null=True, blank=True)
    manager_review_due = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    competencies = models.ManyToManyField(Competency, related_name="cycles", blank=True)
    launched_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-period_end", "-created_at")
        constraints = [models.UniqueConstraint(fields=("institution", "name"), name="uniq_review_cycle_name")]

    def clean(self):
        self.name = (self.name or "").strip()
        errors = {}
        if not self.name:
            errors["name"] = "Name the review cycle."
        if self.period_start and self.period_end and self.period_end < self.period_start:
            errors["period_end"] = "The period cannot end before it starts."
        if self.self_assessment_due and self.manager_review_due and self.manager_review_due < self.self_assessment_due:
            errors["manager_review_due"] = "Manager reviews are due after self-assessments."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.name


class PerformanceReview(TenantOwnedModel):
    class Status(models.TextChoices):
        SELF_ASSESSMENT = "SELF_ASSESSMENT", "Self-assessment"
        MANAGER_REVIEW = "MANAGER_REVIEW", "Manager review"
        HR_REVIEW = "HR_REVIEW", "HR sign-off"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    OPEN_STATUSES = (Status.SELF_ASSESSMENT, Status.MANAGER_REVIEW, Status.HR_REVIEW)

    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="performance_reviews")
    cycle = models.ForeignKey(ReviewCycle, on_delete=models.CASCADE, related_name="reviews")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="performance_reviews")
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="performance_reviews_to_give")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SELF_ASSESSMENT)
    self_summary = models.TextField(blank=True)
    self_submitted_at = models.DateTimeField(null=True, blank=True)
    manager_summary = models.TextField(blank=True)
    development_plan = models.TextField(blank=True)
    overall_rating = models.PositiveSmallIntegerField(null=True, blank=True, validators=RATING_VALIDATORS)
    manager_submitted_at = models.DateTimeField(null=True, blank=True)
    hr_comment = models.TextField(blank=True)
    signed_off_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    signed_off_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("employee__last_name", "employee__first_name")
        constraints = [models.UniqueConstraint(fields=("cycle", "employee"), name="uniq_review_per_cycle_employee")]
        indexes = [models.Index(fields=("institution", "status")), models.Index(fields=("reviewer", "status"))]

    def clean(self):
        errors = {}
        for name in ("cycle", "employee"):
            related = getattr(self, name, None)
            if related is not None and related.institution_id != self.institution_id:
                errors[name] = "Referenced record must belong to the same institution."
        if self.reviewer_id and self.employee_id and self.employee.user_id == self.reviewer_id:
            errors["reviewer"] = "An employee cannot review themselves."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.cycle} - {self.employee}"


class ReviewRating(TenantOwnedModel):
    institution = models.ForeignKey(Institution, on_delete=models.CASCADE, related_name="+")
    review = models.ForeignKey(PerformanceReview, on_delete=models.CASCADE, related_name="ratings")
    competency = models.ForeignKey(Competency, on_delete=models.PROTECT, related_name="+")
    self_rating = models.PositiveSmallIntegerField(null=True, blank=True, validators=RATING_VALIDATORS)
    self_comment = models.TextField(blank=True)
    manager_rating = models.PositiveSmallIntegerField(null=True, blank=True, validators=RATING_VALIDATORS)
    manager_comment = models.TextField(blank=True)

    class Meta:
        ordering = ("competency__sort_order", "competency__name")
        constraints = [models.UniqueConstraint(fields=("review", "competency"), name="uniq_rating_per_review_competency")]
