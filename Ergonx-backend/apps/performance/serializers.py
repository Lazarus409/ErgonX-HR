from rest_framework import serializers

from apps.performance.models import Competency, PerformanceReview, ReviewCycle
from common.serializers import ValidatedModelSerializer

SELF_FIELDS = ("self_summary", "self_submitted_at")
MANAGER_FIELDS = ("manager_summary", "development_plan", "overall_rating", "manager_submitted_at", "hr_comment", "signed_off_by_name", "signed_off_at")


def _name(user):
    return (user.get_full_name() or user.email) if user else ""


class CompetencySerializer(ValidatedModelSerializer):
    class Meta:
        model = Competency
        fields = ("id", "name", "description", "sort_order", "is_active", "created_at")
        read_only_fields = ("id", "is_active", "created_at")


class ReviewCycleSerializer(ValidatedModelSerializer):
    competencies = serializers.PrimaryKeyRelatedField(many=True, queryset=Competency.objects.all())
    competency_names = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True, required=False)
    completed_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = ReviewCycle
        fields = (
            "id", "name", "description", "period_start", "period_end", "self_assessment_due", "manager_review_due",
            "status", "competencies", "competency_names", "review_count", "completed_count", "launched_at", "closed_at", "created_at",
        )
        read_only_fields = ("id", "status", "launched_at", "closed_at", "created_at")

    def get_competency_names(self, obj) -> list[str]:
        return [item.name for item in obj.competencies.all()]

    def validate_competencies(self, value):
        institution = self.context["request"].institution
        if any(item.institution_id != institution.id or not item.is_active for item in value):
            raise serializers.ValidationError("Choose active competencies of this institution.")
        return value

    def create(self, validated_data):
        competencies = validated_data.pop("competencies", [])
        cycle = super().create(validated_data)
        cycle.competencies.set(competencies)
        return cycle

    def update(self, instance, validated_data):
        competencies = validated_data.pop("competencies", None)
        cycle = super().update(instance, validated_data)
        if competencies is not None:
            cycle.competencies.set(competencies)
        return cycle


class ViewerMixin:
    """Who is looking at a review decides which halves of it they see."""

    def viewer(self, obj):
        request = self.context["request"]
        is_hr = self.context.get("is_hr", False)
        is_employee = obj.employee.user_id == request.user.id
        is_reviewer = obj.reviewer_id == request.user.id
        return is_hr, is_employee, is_reviewer

    def hide(self, data, obj):
        is_hr, is_employee, is_reviewer = self.viewer(obj)
        if not is_hr and not is_reviewer and obj.status != PerformanceReview.Status.COMPLETED:
            # The employee sees the manager's assessment once HR has signed it off.
            for field in MANAGER_FIELDS:
                if field in data:
                    data[field] = None
            for rating in data.get("ratings", []):
                rating["manager_rating"] = None
                rating["manager_comment"] = ""
        if not is_hr and not is_employee and obj.status == PerformanceReview.Status.SELF_ASSESSMENT:
            # Reviewers see the self-assessment only once it is submitted.
            for field in SELF_FIELDS:
                if field in data:
                    data[field] = None
            for rating in data.get("ratings", []):
                rating["self_rating"] = None
                rating["self_comment"] = ""
        return data


class PerformanceReviewListSerializer(ViewerMixin, serializers.ModelSerializer):
    cycle_name = serializers.CharField(source="cycle.name", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_number = serializers.CharField(source="employee.employee_number", read_only=True)
    reviewer_name = serializers.SerializerMethodField()

    class Meta:
        model = PerformanceReview
        fields = ("id", "cycle", "cycle_name", "employee", "employee_name", "employee_number", "reviewer", "reviewer_name", "status", "overall_rating", "self_submitted_at", "manager_submitted_at", "signed_off_at")
        read_only_fields = fields

    def get_reviewer_name(self, obj) -> str:
        return _name(obj.reviewer)

    def to_representation(self, instance):
        return self.hide(super().to_representation(instance), instance)


class PerformanceReviewSerializer(PerformanceReviewListSerializer):
    cycle_status = serializers.CharField(source="cycle.status", read_only=True)
    self_assessment_due = serializers.DateField(source="cycle.self_assessment_due", read_only=True)
    manager_review_due = serializers.DateField(source="cycle.manager_review_due", read_only=True)
    signed_off_by_name = serializers.SerializerMethodField()
    ratings = serializers.SerializerMethodField()
    viewer = serializers.SerializerMethodField()

    class Meta(PerformanceReviewListSerializer.Meta):
        fields = PerformanceReviewListSerializer.Meta.fields + (
            "cycle_status", "self_assessment_due", "manager_review_due", "self_summary", "manager_summary", "development_plan",
            "hr_comment", "signed_off_by_name", "ratings", "viewer",
        )
        read_only_fields = fields

    def get_signed_off_by_name(self, obj) -> str:
        return _name(obj.signed_off_by)

    def get_ratings(self, obj) -> list[dict]:
        return [
            {
                "competency_id": str(row.competency_id), "competency": row.competency.name, "description": row.competency.description,
                "self_rating": row.self_rating, "self_comment": row.self_comment, "manager_rating": row.manager_rating, "manager_comment": row.manager_comment,
            }
            for row in obj.ratings.select_related("competency").all()
        ]

    def get_viewer(self, obj) -> dict:
        is_hr, is_employee, is_reviewer = self.viewer(obj)
        open_cycle = obj.cycle.status == ReviewCycle.Status.ACTIVE
        status = obj.status
        return {
            "is_employee": is_employee,
            "is_reviewer": is_reviewer,
            "is_hr": is_hr,
            "can_self_assess": is_employee and open_cycle and status == PerformanceReview.Status.SELF_ASSESSMENT,
            "can_manager_review": is_reviewer and open_cycle and status == PerformanceReview.Status.MANAGER_REVIEW,
            "can_sign_off": is_hr and not is_employee and status == PerformanceReview.Status.HR_REVIEW,
            "can_manage": is_hr and status in PerformanceReview.OPEN_STATUSES,
        }


class RatingInputSerializer(serializers.Serializer):
    competency = serializers.UUIDField()
    rating = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True)
    comment = serializers.CharField(required=False, allow_blank=True, default="")


class SelfAssessmentSerializer(serializers.Serializer):
    ratings = RatingInputSerializer(many=True, required=False)
    summary = serializers.CharField(required=False, allow_blank=True)
    submit = serializers.BooleanField(default=False)


class ManagerReviewSerializer(SelfAssessmentSerializer):
    development_plan = serializers.CharField(required=False, allow_blank=True)
    overall_rating = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True)


class LaunchSerializer(serializers.Serializer):
    employees = serializers.ListField(child=serializers.UUIDField(), required=False)
    all_active = serializers.BooleanField(default=False)
    departments = serializers.ListField(child=serializers.UUIDField(), required=False)


def ratings_map(items):
    return {str(item["competency"]): {"rating": item.get("rating"), "comment": item.get("comment", "")} for item in items or []}
