from collections import Counter

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.employees.models import Employee, Employment
from apps.institutions.models import InstitutionMembership
from apps.notifications.models import Notification
from apps.performance.models import RATING_LABELS, PerformanceReview, ReviewCycle, ReviewRating

Status = PerformanceReview.Status


def has_permission(user, institution, code):
    return InstitutionMembership.objects.filter(
        institution=institution, user=user, status=InstitutionMembership.Status.ACTIVE, role__permissions__code=code
    ).exists()


def _active_member(user, institution):
    return user is not None and InstitutionMembership.objects.filter(institution=institution, user=user, status=InstitutionMembership.Status.ACTIVE).exists()


def _notify(user, review, notification_type, title, message):
    if user is None:
        return
    Notification.objects.create(
        institution=review.institution, user=user, notification_type=notification_type, title=title, message=message,
        channel=Notification.Channel.IN_APP,
        metadata={"performance_review_id": str(review.id), "route_hint": f"/reviews/{review.id}"},
    )


def _audit(review, actor, action, **metadata):
    record_audit_event(actor=actor, institution=review.institution, entity=review, action=f"performance.review.{action}",
                       metadata={"cycle": review.cycle.name, "employee_id": str(review.employee_id), **metadata})


def default_reviewer(employee):
    """The employee's line manager, else their department head; None if neither is an active member."""
    employment = Employment.objects.filter(employee=employee, is_current=True).select_related("reports_to__employee", "department__head").first()
    if employment is None:
        return None
    candidates = []
    if employment.reports_to_id:
        candidates.append(employment.reports_to.employee.user)
    if employment.department_id and employment.department.head_id:
        candidates.append(employment.department.head.user)
    for user in candidates:
        if user is not None and user.id != employee.user_id and _active_member(user, employee.institution):
            return user
    return None


def _lock(review):
    # Lock only the review row: PostgreSQL cannot lock the nullable (outer-joined) reviewer side.
    return PerformanceReview.objects.select_for_update(of=("self",)).select_related("cycle", "employee", "reviewer").get(pk=review.pk)


@transaction.atomic
def launch_cycle(*, cycle, actor, employees):
    cycle = ReviewCycle.objects.select_for_update().get(pk=cycle.pk)
    if cycle.status != ReviewCycle.Status.DRAFT:
        raise ValidationError({"status": "Only a draft cycle can be launched."})
    competencies = list(cycle.competencies.filter(is_active=True))
    if not competencies:
        raise ValidationError({"competencies": "Choose at least one competency before launching."})
    employees = [employee for employee in employees if employee.status in (Employee.Status.ACTIVE, Employee.Status.SUSPENDED)]
    if not employees:
        raise ValidationError({"employees": "Choose at least one active employee."})
    reviews = []
    for employee in employees:
        review = PerformanceReview.objects.create(institution=cycle.institution, cycle=cycle, employee=employee, reviewer=default_reviewer(employee))
        ReviewRating.objects.bulk_create([ReviewRating(institution=cycle.institution, review=review, competency=competency) for competency in competencies])
        due = f" by {cycle.self_assessment_due:%d %b %Y}" if cycle.self_assessment_due else ""
        _notify(employee.user, review, "PERFORMANCE_SELF_ASSESSMENT", "Your performance review is open", f"Complete your self-assessment for {cycle.name}{due}.")
        reviews.append(review)
    cycle.status = ReviewCycle.Status.ACTIVE
    cycle.launched_at = timezone.now()
    cycle.save(update_fields=("status", "launched_at", "updated_at"))
    record_audit_event(actor=actor, institution=cycle.institution, entity=cycle, action="performance.cycle.launched", metadata={"reviews": len(reviews)})
    return reviews


@transaction.atomic
def close_cycle(*, cycle, actor):
    cycle = ReviewCycle.objects.select_for_update().get(pk=cycle.pk)
    if cycle.status != ReviewCycle.Status.ACTIVE:
        raise ValidationError({"status": "Only an active cycle can be closed."})
    cycle.status = ReviewCycle.Status.CLOSED
    cycle.closed_at = timezone.now()
    cycle.save(update_fields=("status", "closed_at", "updated_at"))
    open_reviews = cycle.reviews.filter(status__in=PerformanceReview.OPEN_STATUSES).count()
    record_audit_event(actor=actor, institution=cycle.institution, entity=cycle, action="performance.cycle.closed", metadata={"open_reviews": open_reviews})
    return cycle


def _apply_ratings(review, ratings, side):
    """``ratings`` is ``{competency_id: {"rating": 1-5 | None, "comment": str}}``."""
    rows = {str(row.competency_id): row for row in review.ratings.all()}
    for competency_id, value in (ratings or {}).items():
        row = rows.get(str(competency_id))
        if row is None:
            raise ValidationError({"ratings": "A rating refers to a competency that is not part of this review."})
        rating = value.get("rating")
        if rating is not None and (not isinstance(rating, int) or not 1 <= rating <= 5):
            raise ValidationError({"ratings": "Ratings are whole numbers from 1 to 5."})
        setattr(row, f"{side}_rating", rating)
        setattr(row, f"{side}_comment", (value.get("comment") or "").strip())
        row.save(update_fields=(f"{side}_rating", f"{side}_comment", "updated_at"))
    return list(rows.values())


def _require_cycle_open(review):
    if review.cycle.status != ReviewCycle.Status.ACTIVE:
        raise ValidationError({"cycle": "This review cycle is not open."})


@transaction.atomic
def save_self_assessment(*, review, actor, ratings=None, summary=None, submit=False):
    review = _lock(review)
    _require_cycle_open(review)
    if review.employee.user_id != actor.id:
        raise ValidationError({"actor": "Only the employee completes their own self-assessment."})
    if review.status != Status.SELF_ASSESSMENT:
        raise ValidationError({"status": "The self-assessment has already been submitted."})
    rows = _apply_ratings(review, ratings, "self")
    if summary is not None:
        review.self_summary = summary.strip()
    if submit:
        if any(row.self_rating is None for row in rows):
            raise ValidationError({"ratings": "Rate yourself on every competency before submitting."})
        review.status = Status.MANAGER_REVIEW
        review.self_submitted_at = timezone.now()
    review.save()
    if submit:
        _audit(review, actor, "self_submitted")
        _notify(review.reviewer, review, "PERFORMANCE_MANAGER_REVIEW", "Performance review to complete", f"{review.employee.full_name} has submitted their self-assessment for {review.cycle.name}.")
    return review


@transaction.atomic
def save_manager_review(*, review, actor, ratings=None, summary=None, development_plan=None, overall_rating=None, submit=False):
    review = _lock(review)
    _require_cycle_open(review)
    if review.reviewer_id != actor.id:
        raise ValidationError({"actor": "Only the assigned reviewer completes the manager review."})
    if review.status != Status.MANAGER_REVIEW:
        raise ValidationError({"status": "This review is not waiting for the manager."})
    rows = _apply_ratings(review, ratings, "manager")
    if summary is not None:
        review.manager_summary = summary.strip()
    if development_plan is not None:
        review.development_plan = development_plan.strip()
    if overall_rating is not None:
        if not isinstance(overall_rating, int) or not 1 <= overall_rating <= 5:
            raise ValidationError({"overall_rating": "The overall rating is a whole number from 1 to 5."})
        review.overall_rating = overall_rating
    if submit:
        if any(row.manager_rating is None for row in rows) or review.overall_rating is None:
            raise ValidationError({"ratings": "Rate every competency and give an overall rating before submitting."})
        review.status = Status.HR_REVIEW
        review.manager_submitted_at = timezone.now()
    review.save()
    if submit:
        _audit(review, actor, "manager_submitted", overall_rating=review.overall_rating)
        for membership in InstitutionMembership.objects.filter(institution=review.institution, status=InstitutionMembership.Status.ACTIVE, role__permissions__code="performance.manage").exclude(user=review.employee.user).select_related("user").distinct():
            _notify(membership.user, review, "PERFORMANCE_SIGN_OFF", "Performance review ready for sign-off", f"{review.employee.full_name} · {review.cycle.name}.")
    return review


def _require_manager(actor, review):
    if not has_permission(actor, review.institution, "performance.manage"):
        raise ValidationError({"actor": "Only HR can do this."})


@transaction.atomic
def release_to_reviewer(*, review, actor):
    """HR moves a review on when the employee has not completed their self-assessment."""
    review = _lock(review)
    _require_manager(actor, review)
    _require_cycle_open(review)
    if review.status != Status.SELF_ASSESSMENT:
        raise ValidationError({"status": "Only reviews awaiting self-assessment can be released."})
    review.status = Status.MANAGER_REVIEW
    review.save(update_fields=("status", "updated_at"))
    _audit(review, actor, "released_to_reviewer")
    _notify(review.reviewer, review, "PERFORMANCE_MANAGER_REVIEW", "Performance review to complete", f"{review.employee.full_name} · {review.cycle.name} (no self-assessment).")
    return review


@transaction.atomic
def sign_off(*, review, actor, comment=""):
    review = _lock(review)
    _require_manager(actor, review)
    if review.status != Status.HR_REVIEW:
        raise ValidationError({"status": "Only reviews awaiting HR can be signed off."})
    if review.employee.user_id == actor.id:
        raise ValidationError({"actor": "You cannot sign off your own review."})
    review.status = Status.COMPLETED
    review.hr_comment = (comment or "").strip()
    review.signed_off_by = actor
    review.signed_off_at = timezone.now()
    review.save()
    _audit(review, actor, "signed_off", overall_rating=review.overall_rating)
    _notify(review.employee.user, review, "PERFORMANCE_COMPLETED", "Your performance review is complete", f"{review.cycle.name}: {RATING_LABELS.get(review.overall_rating, '')}.")
    return review


@transaction.atomic
def return_to_reviewer(*, review, actor, comment):
    review = _lock(review)
    _require_manager(actor, review)
    if review.status != Status.HR_REVIEW:
        raise ValidationError({"status": "Only reviews awaiting HR can be returned."})
    if not (comment or "").strip():
        raise ValidationError({"comment": "Explain what the reviewer should change."})
    review.status = Status.MANAGER_REVIEW
    review.hr_comment = comment.strip()
    review.save(update_fields=("status", "hr_comment", "updated_at"))
    _audit(review, actor, "returned", comment=comment.strip())
    _notify(review.reviewer, review, "PERFORMANCE_RETURNED", "Performance review returned", f"{review.employee.full_name}: {comment.strip()}")
    return review


@transaction.atomic
def reassign_reviewer(*, review, actor, reviewer):
    review = _lock(review)
    _require_manager(actor, review)
    if review.status not in PerformanceReview.OPEN_STATUSES:
        raise ValidationError({"status": "Only open reviews can be reassigned."})
    if not _active_member(reviewer, review.institution):
        raise ValidationError({"reviewer": "The reviewer must be an active member."})
    previous = review.reviewer
    review.reviewer = reviewer
    review.save()
    _audit(review, actor, "reassigned", reviewer_id=str(reviewer.id), previous_reviewer_id=str(previous.id) if previous else "")
    if review.status == Status.MANAGER_REVIEW:
        _notify(reviewer, review, "PERFORMANCE_MANAGER_REVIEW", "Performance review to complete", f"{review.employee.full_name} · {review.cycle.name}.")
    return review


@transaction.atomic
def cancel_review(*, review, actor, reason=""):
    review = _lock(review)
    _require_manager(actor, review)
    if review.status not in PerformanceReview.OPEN_STATUSES:
        raise ValidationError({"status": "Only open reviews can be cancelled."})
    review.status = Status.CANCELLED
    review.hr_comment = (reason or "").strip()
    review.save(update_fields=("status", "hr_comment", "updated_at"))
    _audit(review, actor, "cancelled", reason=review.hr_comment)
    return review


def cycle_summary(reviews):
    """Progress and rating distribution for a set of reviews (one cycle, possibly scoped)."""
    reviews = list(reviews.select_related("employee"))
    statuses = Counter(review.status for review in reviews)
    live = [review for review in reviews if review.status != Status.CANCELLED]
    completed = [review for review in live if review.status == Status.COMPLETED]
    ratings = Counter(review.overall_rating for review in completed if review.overall_rating)
    departments = dict(Employment.objects.filter(employee__in=[review.employee_id for review in completed], is_current=True).values_list("employee_id", "department__name"))
    by_department = {}
    for review in completed:
        if review.overall_rating:
            by_department.setdefault(departments.get(review.employee_id) or "Unassigned", []).append(review.overall_rating)
    return {
        "total": len(live),
        "by_status": {status: statuses.get(status, 0) for status in Status.values},
        "completion_rate": round(len(completed) * 100 / len(live), 1) if live else 0.0,
        "average_rating": round(sum(ratings.elements()) / sum(ratings.values()), 2) if ratings else None,
        "rating_distribution": [{"rating": value, "label": RATING_LABELS[value], "count": ratings.get(value, 0)} for value in range(1, 6)],
        "by_department": sorted(({"department": name, "average_rating": round(sum(values) / len(values), 2), "reviews": len(values)} for name, values in by_department.items()), key=lambda row: row["department"]),
    }
