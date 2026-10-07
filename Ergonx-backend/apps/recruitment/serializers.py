from rest_framework import serializers

from apps.compensation.models import SalaryStructure
from apps.organization.models import Department, Grade, Location, Position
from apps.recruitment.models import Application, ApplicationStageHistory, Candidate, CandidateEvaluation, Interview, JobPosting, Offer, RecruitmentStage
from apps.recruitment.services import record_evaluation
from common.serializers import ValidatedModelSerializer, call_validated_service


class TenantRelationSerializer(ValidatedModelSerializer):
    tenant_relations = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            for name, model in self.tenant_relations.items():
                self.fields[name].queryset = model.objects.for_institution(institution)


class JobPostingSerializer(TenantRelationSerializer):
    tenant_relations = {"department": Department, "position": Position, "location": Location}
    department_name = serializers.CharField(source="department.name", read_only=True)
    position_title = serializers.CharField(source="position.title", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    grade_name = serializers.CharField(source="grade.name", read_only=True, default=None)
    reports_to_title = serializers.CharField(source="reports_to.title", read_only=True, default=None)
    hiring_manager_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    application_counts = serializers.SerializerMethodField()

    @staticmethod
    def _name(user):
        return (user.get_full_name() or user.email) if user else None

    def get_hiring_manager_name(self, obj):
        return self._name(obj.hiring_manager)

    def get_submitted_by_name(self, obj):
        return self._name(obj.submitted_by)

    def get_approved_by_name(self, obj):
        return self._name(obj.approved_by)

    def get_application_counts(self, obj):
        from django.db.models import Count

        rows = obj.applications.values("status").annotate(count=Count("id"))
        counts = {row["status"]: row["count"] for row in rows}
        counts["total"] = sum(counts.values())
        return counts

    class Meta:
        model = JobPosting
        fields = (
            "id", "code", "title", "department", "department_name", "position", "position_title", "location", "location_name",
            "hiring_manager", "hiring_manager_name", "description", "employment_type", "openings", "status", "opens_on", "closes_on",
            "hiring_reason", "grade", "grade_name", "reports_to", "reports_to_title", "target_start_date", "salary_currency",
            "salary_min", "salary_max", "interview_plan", "responsibilities", "qualifications_essential", "qualifications_desirable",
            "submitted_by", "submitted_by_name", "submitted_at", "approved_by", "approved_by_name", "approved_at", "approval_note",
            "application_counts", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "status", "opens_on", "submitted_by", "submitted_at", "approved_by", "approved_at", "approval_note",
            "created_at", "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            from apps.organization.models import Grade

            self.fields["grade"].queryset = Grade.objects.for_institution(institution)
            self.fields["reports_to"].queryset = Position.objects.for_institution(institution)

    def validate_hiring_manager(self, value):
        institution = self.context["request"].institution
        if value and not value.memberships.filter(institution=institution, status="ACTIVE").exists():
            raise serializers.ValidationError("Hiring manager must be an active institution member.")
        return value

    def update(self, instance, validated_data):
        if instance.status not in {JobPosting.Status.DRAFT, JobPosting.Status.APPROVED, JobPosting.Status.OPEN}:
            raise serializers.ValidationError({"status": "Requisitions pending approval, closed or cancelled cannot be edited."})
        if instance.status == JobPosting.Status.APPROVED:
            # Material edits after approval send the requisition back for re-approval.
            instance.status = JobPosting.Status.DRAFT
            instance.approved_by = None
            instance.approved_at = None
        return super().update(instance, validated_data)


class JobPostingTeamMemberSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_email = serializers.EmailField(source="user.email", read_only=True)

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.email

    class Meta:
        from apps.recruitment.models import JobPostingTeamMember

        model = JobPostingTeamMember
        fields = ("id", "job_posting", "user", "user_name", "user_email", "role", "created_at")
        read_only_fields = ("id", "job_posting", "user_name", "user_email", "created_at")


class RequisitionDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class CandidateSerializer(TenantRelationSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = Candidate
        fields = (
            "id", "first_name", "middle_name", "last_name", "full_name", "email", "phone", "source", "status", "notes",
            "location", "employment_status", "linkedin_url", "current_employer", "current_title", "years_experience",
            "highest_qualification", "field_of_study", "education_institution", "skills", "notice_period_weeks",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at")


class ScorecardRatingSerializer(serializers.Serializer):
    competency = serializers.UUIDField()
    rating = serializers.ChoiceField(choices=("NOT_ASSESSED", "DOES_NOT_MEET", "PARTIALLY_MEETS", "MEETS", "EXCEEDS"))
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class ScorecardSerializer(serializers.Serializer):
    ratings = ScorecardRatingSerializer(many=True)
    submit = serializers.BooleanField(required=False, default=False)


class RecruitmentStageSerializer(TenantRelationSerializer):
    class Meta:
        model = RecruitmentStage
        fields = ("id", "name", "sequence", "is_terminal", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ApplicationSerializer(TenantRelationSerializer):
    tenant_relations = {"job_posting": JobPosting, "candidate": Candidate, "current_stage": RecruitmentStage}

    class Meta:
        model = Application
        fields = ("id", "job_posting", "candidate", "current_stage", "status", "applied_at", "withdrawn_at", "rejected_at", "rejection_reason", "notes", "created_at", "updated_at")
        read_only_fields = ("id", "current_stage", "status", "applied_at", "withdrawn_at", "rejected_at", "rejection_reason", "created_at", "updated_at")


class ApplicationStageHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ApplicationStageHistory
        fields = ("id", "application", "from_stage", "to_stage", "changed_by", "comment", "created_at")
        read_only_fields = fields


def _person(user):
    return (user.get_full_name() or user.email) if user else None


class InterviewSerializer(TenantRelationSerializer):
    tenant_relations = {"application": Application}
    candidate_id = serializers.UUIDField(source="application.candidate_id", read_only=True)
    candidate_name = serializers.CharField(source="application.candidate.full_name", read_only=True)
    job_title = serializers.CharField(source="application.job_posting.title", read_only=True)
    interviewer_name = serializers.SerializerMethodField()
    panel_members = serializers.SerializerMethodField()

    def get_interviewer_name(self, obj):
        return _person(obj.interviewer)

    def get_panel_members(self, obj):
        return [{"id": str(user.id), "name": _person(user)} for user in obj.panel.all()]

    class Meta:
        model = Interview
        fields = (
            "id", "application", "candidate_id", "candidate_name", "job_title", "scheduled_at", "duration_minutes", "interview_type",
            "interview_stage", "mode", "time_zone", "agenda", "location_or_link", "interviewer", "interviewer_name", "panel_members",
            "candidate_message", "invitation_sent_at", "invitation_status", "status", "notes", "created_at", "updated_at",
        )
        read_only_fields = ("id", "status", "candidate_message", "invitation_sent_at", "invitation_status", "created_at", "updated_at")


class InterviewScheduleSerializer(serializers.Serializer):
    application = serializers.UUIDField()
    scheduled_at = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(min_value=15, max_value=480)
    interview_stage = serializers.ChoiceField(choices=Interview.Stage.choices)
    mode = serializers.ChoiceField(choices=Interview.Mode.choices)
    time_zone = serializers.CharField(max_length=64)
    location_or_link = serializers.CharField(required=False, allow_blank=True, max_length=500)
    agenda = serializers.CharField(required=False, allow_blank=True, max_length=500)
    panel = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)
    candidate_message = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    draft = serializers.BooleanField(required=False, default=False)
    send_invitation = serializers.BooleanField(required=False, default=True)

    def validate_interviewer(self, value):
        institution = self.context["request"].institution
        if value and not value.memberships.filter(institution=institution, status="ACTIVE").exists():
            raise serializers.ValidationError("Interviewer must be an active institution member.")
        return value


class CandidateEvaluationSerializer(TenantRelationSerializer):
    tenant_relations = {"application": Application, "interview": Interview}
    interviewer = serializers.UUIDField(read_only=True, source="interviewer_id")

    class Meta:
        model = CandidateEvaluation
        fields = ("id", "application", "interviewer", "interview", "score", "recommendation", "comments", "created_at", "updated_at")
        read_only_fields = ("id", "interviewer", "created_at", "updated_at")

    def create(self, validated_data):
        request = self.context["request"]
        return call_validated_service(record_evaluation, institution=request.institution, interviewer=request.user, actor=request.user, **validated_data)


class OfferSerializer(TenantRelationSerializer):
    tenant_relations = {"application": Application, "department": Department, "position": Position, "grade": Grade, "location": Location, "salary_structure": SalaryStructure, "reports_to": Position}
    candidate_id = serializers.UUIDField(source="application.candidate_id", read_only=True)
    candidate_name = serializers.CharField(source="application.candidate.full_name", read_only=True)
    job_posting_id = serializers.UUIDField(source="application.job_posting_id", read_only=True)
    job_title = serializers.CharField(source="application.job_posting.title", read_only=True)
    job_code = serializers.CharField(source="application.job_posting.code", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    position_title = serializers.CharField(source="position.title", read_only=True)
    grade_name = serializers.CharField(source="grade.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    reports_to_title = serializers.CharField(source="reports_to.title", read_only=True, default=None)
    salary_structure_name = serializers.CharField(source="salary_structure.name", read_only=True, default=None)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    response_recorded_by_name = serializers.SerializerMethodField()

    def get_submitted_by_name(self, obj):
        return _person(obj.submitted_by)

    def get_approved_by_name(self, obj):
        return _person(obj.approved_by)

    def get_response_recorded_by_name(self, obj):
        return _person(obj.response_recorded_by)

    class Meta:
        model = Offer
        fields = (
            "id", "application", "candidate_id", "candidate_name", "job_posting_id", "job_title", "job_code", "status",
            "proposed_start_date", "expires_on", "employment_type", "department", "department_name", "position", "position_title",
            "grade", "grade_name", "location", "location_name", "staff_category", "salary_structure", "salary_structure_name",
            "base_salary", "currency", "contract_length_months", "working_pattern", "reports_to", "reports_to_title",
            "letter_body", "letter_generated_at", "submitted_by", "submitted_by_name", "submitted_at", "approved_by", "approved_by_name",
            "approved_at", "approval_note", "response_note", "response_recorded_by_name", "extended_at", "accepted_at", "declined_at",
            "hired_employee", "terms", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "status", "letter_generated_at", "submitted_by", "submitted_at", "approved_by", "approved_at", "approval_note",
            "response_note", "extended_at", "accepted_at", "declined_at", "hired_employee", "created_at", "updated_at",
        )

    def update(self, instance, validated_data):
        if instance.status not in {Offer.Status.DRAFT, Offer.Status.APPROVED}:
            raise serializers.ValidationError({"status": "Only draft or approved offers can be edited."})
        if instance.status == Offer.Status.APPROVED and set(validated_data) - {"letter_body"}:
            # Changing approved terms sends the offer back for approval.
            instance.status = Offer.Status.DRAFT
            instance.approved_by = None
            instance.approved_at = None
        return super().update(instance, validated_data)


class OfferResponseSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=4000)


class CommentSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=4000)


class StageMoveSerializer(CommentSerializer):
    stage = serializers.UUIDField()


class InterviewStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=(Interview.Status.COMPLETED, Interview.Status.CANCELLED, Interview.Status.NO_SHOW))


class RejectionSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=4000)


class HireCandidateSerializer(serializers.Serializer):
    # Blank means "generate the next employee number".
    employee_number = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
