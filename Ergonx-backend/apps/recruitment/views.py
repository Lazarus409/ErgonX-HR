from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.recruitment.models import Application, ApplicationStageHistory, Candidate, CandidateEvaluation, Interview, JobPosting, Offer, RecruitmentStage
from apps.recruitment.selectors import applications_for_institution, candidate_scorecard, recruitment_pipeline
from apps.recruitment.serializers import (JobPostingTeamMemberSerializer, RequisitionDecisionSerializer, ApplicationSerializer, ApplicationStageHistorySerializer, CandidateEvaluationSerializer, CandidateSerializer, CommentSerializer, HireCandidateSerializer, InterviewSerializer, InterviewStatusSerializer, JobPostingSerializer, OfferSerializer, RecruitmentStageSerializer, RejectionSerializer, ScorecardSerializer, StageMoveSerializer, InterviewScheduleSerializer, OfferResponseSerializer)
from apps.recruitment.services import (approve_offer, generate_offer_letter, interview_availability, return_offer, schedule_interview, submit_offer_for_approval, CANDIDATE_DOCUMENT_CATEGORIES, application_scorecard, attach_candidate_document, remove_candidate_document, save_application_scorecard, add_hiring_team_member, approve_job_posting, remove_hiring_team_member, return_job_posting, submit_job_posting_for_approval, close_job_posting, decide_offer, extend_offer, hire_candidate, move_application_stage, publish_job_posting, reject_application, submit_application, update_interview_status, withdraw_application, withdraw_offer)
from apps.institutions.services import record_user_activity
from apps.documents.models import Document
from apps.documents.serializers import DocumentSerializer
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class RecruitmentViewSet(TenantModelViewSet):
    required_module = "RECRUITMENT"


class JobPostingViewSet(RecruitmentViewSet):
    model = JobPosting
    serializer_class = JobPostingSerializer
    permission_resource = "job_posting"
    # Records are kept for audit: DELETE serves only the nested actions below,
    # never the record itself (W0-API-02).
    http_method_names = ("get", "post", "put", "patch", "delete", "head", "options")

    @extend_schema(exclude=True)
    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method)
    filterset_fields = ("status", "department", "position", "location", "employment_type")
    search_fields = ("code", "title", "description")
    ordering_fields = ("code", "title", "opens_on", "closes_on", "created_at", "updated_at")

    @extend_schema(operation_id="recruitment_job_posting_publish")
    @action(detail=True, methods=("post",))
    def publish(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(publish_job_posting, job_posting=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def close(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(close_job_posting, job_posting=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def cancel(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(close_job_posting, job_posting=self.get_object(), actor=request.user, cancelled=True)).data)

    @action(detail=True, methods=("post",), url_path="submit-approval")
    def submit_approval(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(submit_job_posting_for_approval, job_posting=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        payload = RequisitionDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(approve_job_posting, job_posting=self.get_object(), actor=request.user, comment=payload.validated_data.get("comment", ""))).data)

    @action(detail=True, methods=("post",), url_path="return")
    def return_for_changes(self, request, pk=None):
        payload = RequisitionDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(return_job_posting, job_posting=self.get_object(), actor=request.user, comment=payload.validated_data.get("comment", ""))).data)

    @action(detail=True, methods=("get", "post"))
    def team(self, request, pk=None):
        from django.contrib.auth import get_user_model

        posting = self.get_object()
        if request.method == "POST":
            payload = JobPostingTeamMemberSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            user = get_user_model().objects.filter(pk=request.data.get("user")).first()
            member = call_validated_service(add_hiring_team_member, job_posting=posting, actor=request.user, user=user, role=payload.validated_data["role"])
            return Response(JobPostingTeamMemberSerializer(member).data, status=201)
        return Response(JobPostingTeamMemberSerializer(posting.team_members.select_related("user"), many=True).data)

    @action(detail=True, methods=("delete",), url_path=r"team/(?P<member_id>[0-9a-f-]+)")
    def remove_team_member(self, request, pk=None, member_id=None):
        from rest_framework.exceptions import NotFound

        member = self.get_object().team_members.filter(pk=member_id).first()
        if member is None:
            raise NotFound("Team member not found.")
        call_validated_service(remove_hiring_team_member, member=member, actor=request.user)
        return Response(status=204)

    @action(detail=False, methods=("get",))
    def people(self, request):
        """Active members (name and role only) for hiring-manager and hiring-team pickers."""
        from apps.institutions.models import InstitutionMembership

        members = (
            InstitutionMembership.objects.filter(institution=request.institution, status=InstitutionMembership.Status.ACTIVE)
            .select_related("user", "role").order_by("user__first_name", "user__last_name")
        )
        return Response([
            {"id": str(item.user_id), "name": item.user.get_full_name() or item.user.email, "role": item.role.name if item.role_id else ""}
            for item in members
        ])

    @action(detail=True, methods=("get",))
    def history(self, request, pk=None):
        from apps.audit.models import AuditLog

        posting = self.get_object()
        entries = AuditLog.objects.filter(institution=request.institution, entity_id=posting.id).select_related("actor").order_by("-created_at")[:50]
        return Response([
            {"id": str(entry.id), "action": entry.action, "actor": (entry.actor.get_full_name() or entry.actor.email) if entry.actor else "System", "created_at": entry.created_at, "metadata": entry.metadata}
            for entry in entries
        ])

    @action(detail=True, methods=("get",))
    def activity(self, request, pk=None):
        """Applications for this requisition grouped by stage (candidate activity)."""
        from django.db.models import Count

        posting = self.get_object()
        applications = posting.applications.all()
        by_stage = [
            {"stage": row["current_stage__name"] or "Not staged", "count": row["count"]}
            for row in applications.filter(status__in=("ACTIVE", "OFFERED")).values("current_stage__name", "current_stage__sequence").annotate(count=Count("id")).order_by("current_stage__sequence")
        ]
        recent = [
            {"id": str(item.id), "candidate": item.candidate.full_name, "stage": item.current_stage.name if item.current_stage else None, "status": item.status, "applied_at": item.applied_at}
            for item in applications.select_related("candidate", "current_stage").order_by("-applied_at", "-created_at")[:6]
        ]
        return Response({"by_stage": by_stage, "recent": recent, "total": applications.count()})

    def get_required_permission(self):
        if self.action in {"publish", "close", "cancel", "submit_approval", "team", "remove_team_member"}:
            if self.action == "team" and self.request.method == "GET":
                return "job_posting.view"
            return "job_posting.update"
        if self.action in {"approve", "return_for_changes"}:
            return "job_posting.approve"
        if self.action in {"history", "activity", "people"}:
            return "job_posting.view"
        return super().get_required_permission()


class CandidateViewSet(RecruitmentViewSet):
    model = Candidate
    serializer_class = CandidateSerializer
    permission_resource = "candidate"
    # Records are kept for audit: DELETE serves only the nested actions below,
    # never the record itself (W0-API-02).
    http_method_names = ("get", "post", "put", "patch", "delete", "head", "options")

    @extend_schema(exclude=True)
    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed(request.method)
    filterset_fields = ("status", "source")
    search_fields = ("first_name", "middle_name", "last_name", "email", "phone")
    ordering_fields = ("first_name", "last_name", "email", "created_at", "updated_at")

    def perform_create(self, serializer):
        candidate = serializer.save(institution=self.request.institution)
        record_user_activity(
            actor=self.request.user,
            institution=self.request.institution,
            activity_code="candidate.create",
            entity=candidate,
        )

    @action(detail=True, methods=("get",), url_path="scorecard")
    def scorecard(self, request, pk=None):
        candidate = candidate_scorecard(institution=request.institution, candidate=self.get_object())
        return Response({"candidate_id": candidate.id, "average_score": candidate.average_score, "application_count": candidate.application_count})

    def _documents(self, candidate):
        return Document.objects.for_institution(self.request.institution).filter(
            entity_type="recruitment.Candidate", entity_id=candidate.id, is_active=True
        )

    @action(detail=True, methods=("get", "post"), parser_classes=(MultiPartParser, FormParser, JSONParser))
    def documents(self, request, pk=None):
        candidate = self.get_object()
        if request.method == "POST":
            document = call_validated_service(
                attach_candidate_document, candidate=candidate, actor=request.user,
                uploaded_file=request.FILES.get("uploaded_file"), category=request.data.get("category", ""),
            )
            return Response(DocumentSerializer(document, context={"request": request}).data, status=201)
        return Response(DocumentSerializer(self._documents(candidate), many=True, context={"request": request}).data)

    @action(detail=True, methods=("get",), url_path=r"documents/(?P<document_id>[0-9a-f-]+)/download")
    def download_document(self, request, pk=None, document_id=None):
        from django.http import FileResponse

        document = self._documents(self.get_object()).filter(pk=document_id).first()
        if document is None or not document.stored_file:
            raise NotFound("Document not found.")
        response = FileResponse(document.stored_file.open("rb"), as_attachment=True, filename=document.original_filename,
                                content_type=document.content_type or "application/octet-stream")
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @action(detail=True, methods=("delete",), url_path=r"documents/(?P<document_id>[0-9a-f-]+)")
    def remove_document(self, request, pk=None, document_id=None):
        candidate = self.get_object()
        document = self._documents(candidate).filter(pk=document_id).first()
        if document is None:
            raise NotFound("Document not found.")
        call_validated_service(remove_candidate_document, candidate=candidate, document=document, actor=request.user)
        return Response(status=204)

    @action(detail=False, methods=("get",), url_path="document-categories")
    def document_categories(self, request):
        return Response(list(CANDIDATE_DOCUMENT_CATEGORIES))

    def get_required_permission(self):
        if self.action == "documents":
            return "candidate.update" if self.request.method == "POST" else "candidate.view"
        if self.action in {"download_document", "document_categories", "scorecard"}:
            return "candidate.view"
        if self.action == "remove_document":
            return "candidate.update"
        return super().get_required_permission()


class RecruitmentStageViewSet(RecruitmentViewSet):
    model = RecruitmentStage
    serializer_class = RecruitmentStageSerializer
    filterset_fields = ("is_active", "is_terminal")
    search_fields = ("name",)
    ordering_fields = ("sequence", "name", "created_at", "updated_at")

    def get_required_permission(self):
        return "recruitment_stage.view" if self.action in {"list", "retrieve"} else "recruitment_stage.manage"


class ApplicationViewSet(RecruitmentViewSet):
    model = Application
    serializer_class = ApplicationSerializer
    http_method_names = ("get", "post", "put", "patch", "head", "options")
    filterset_fields = ("job_posting", "candidate", "current_stage", "status")
    search_fields = ("candidate__first_name", "candidate__last_name", "candidate__email", "job_posting__code", "job_posting__title")
    ordering_fields = ("applied_at", "created_at", "updated_at")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Application.objects.none()
        return applications_for_institution(institution=self.request.institution)

    @action(detail=True, methods=("get", "post"))
    def scorecard(self, request, pk=None):
        application = self.get_object()
        if request.method == "POST":
            payload = ScorecardSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            return Response(call_validated_service(
                save_application_scorecard, application=application, actor=request.user,
                ratings=[{**row, "competency": str(row["competency"])} for row in payload.validated_data["ratings"]],
                submit=payload.validated_data["submit"],
            ))
        return Response(application_scorecard(application=application, user=request.user))

    @action(detail=True, methods=("get",))
    def overview(self, request, pk=None):
        """Everything the candidate detail page needs for one application."""
        from apps.audit.models import AuditLog

        application = self.get_object()
        candidate = application.candidate
        posting = application.job_posting
        stages = list(RecruitmentStage.objects.for_institution(request.institution).filter(is_active=True, is_terminal=False).order_by("sequence"))
        current_index = next((index for index, stage in enumerate(stages) if stage.id == application.current_stage_id), None)
        next_stage = stages[current_index + 1] if current_index is not None and current_index + 1 < len(stages) else None
        interviews = list(application.interviews.select_related("interviewer").order_by("-scheduled_at"))
        evaluations = list(CandidateEvaluation.objects.filter(application=application).select_related("interviewer"))
        name = lambda user: (user.get_full_name() or user.email) if user else None  # noqa: E731
        entity_ids = [application.id, candidate.id, *[item.id for item in interviews]]
        offer = getattr(application, "offer", None) if hasattr(application, "offer") else None
        if offer:
            entity_ids.append(offer.id)
        activity = AuditLog.objects.filter(institution=request.institution, entity_id__in=entity_ids).select_related("actor").order_by("-created_at")[:40]
        permissions = request.membership.role.permissions.values_list("code", flat=True) if getattr(request, "membership", None) else []
        permissions = set(permissions)
        active = application.status in (Application.Status.ACTIVE, Application.Status.OFFERED)
        return Response({
            "application": {
                "id": str(application.id), "status": application.status, "applied_at": application.applied_at,
                "created_at": application.created_at, "notes": application.notes, "rejection_reason": application.rejection_reason,
                "current_stage": str(application.current_stage_id) if application.current_stage_id else None,
                "current_stage_name": application.current_stage.name if application.current_stage else None,
            },
            "candidate": CandidateSerializer(candidate, context={"request": request}).data,
            "job": {
                "id": str(posting.id), "code": posting.code, "title": posting.title, "status": posting.status,
                "department_name": posting.department.name, "location_name": posting.location.name,
                "employment_type": posting.employment_type,
            },
            "stages": [{"id": str(stage.id), "name": stage.name, "sequence": stage.sequence} for stage in stages],
            "next_stage": {"id": str(next_stage.id), "name": next_stage.name} if next_stage else None,
            "interviews": [
                {
                    "id": str(item.id), "scheduled_at": item.scheduled_at, "duration_minutes": item.duration_minutes,
                    "interview_type": item.interview_type, "location_or_link": item.location_or_link, "status": item.status,
                    "interviewer_name": name(item.interviewer),
                    "feedback": [
                        {"id": str(row.id), "interviewer_name": name(row.interviewer), "score": row.score, "recommendation": row.recommendation, "comments": row.comments, "created_at": row.created_at}
                        for row in evaluations if row.interview_id == item.id
                    ],
                }
                for item in interviews
            ],
            "general_feedback": [
                {"id": str(row.id), "interviewer_name": name(row.interviewer), "score": row.score, "recommendation": row.recommendation, "comments": row.comments, "created_at": row.created_at}
                for row in evaluations if row.interview_id is None
            ],
            "documents": DocumentSerializer(
                Document.objects.for_institution(request.institution).filter(entity_type="recruitment.Candidate", entity_id=candidate.id, is_active=True),
                many=True, context={"request": request},
            ).data,
            "other_applications": [
                {"id": str(item.id), "job_title": item.job_posting.title, "status": item.status, "stage": item.current_stage.name if item.current_stage else None}
                for item in candidate.applications.exclude(pk=application.pk).select_related("job_posting", "current_stage")
            ],
            "offer": {"id": str(offer.id), "status": offer.status} if offer else None,
            "activity": [
                {"id": str(entry.id), "action": entry.action, "actor": name(entry.actor) or "System", "created_at": entry.created_at, "metadata": entry.metadata}
                for entry in activity
            ],
            "actions": {
                "can_move": active and "candidate.update" in permissions,
                "can_reject": active and "candidate.update" in permissions,
                "can_schedule_interview": active and "interview.manage" in permissions,
                "can_create_offer": active and not offer and "offer.create" in permissions,
                "can_upload_documents": "candidate.update" in permissions,
            },
        })

    def get_required_permission(self):
        if self.action == "scorecard" and self.request.method == "POST":
            # Recording an evaluation is its own grant, not "can view candidates" (W0-PERM-06).
            return "candidate_evaluation.create"
        if self.action in {"scorecard", "overview"}:
            return "candidate.view"
        return {"create": "candidate.create", "submit": "candidate.create", "move_stage": "candidate.update", "withdraw": "candidate.update", "reject": "candidate.update", "stage_history": "candidate.view"}.get(self.action, "candidate.view")

    @action(detail=True, methods=("post",))
    def submit(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(submit_application, application=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",), url_path="move-stage")
    def move_stage(self, request, pk=None):
        payload = StageMoveSerializer(data=request.data); payload.is_valid(raise_exception=True)
        stage = RecruitmentStage.objects.for_institution(request.institution).get(pk=payload.validated_data["stage"])
        return Response(self.get_serializer(call_validated_service(move_application_stage, application=self.get_object(), stage=stage, actor=request.user, comment=payload.validated_data.get("comment", ""))).data)

    @action(detail=True, methods=("post",))
    def withdraw(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(withdraw_application, application=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def reject(self, request, pk=None):
        payload = RejectionSerializer(data=request.data); payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(reject_application, application=self.get_object(), actor=request.user, reason=payload.validated_data.get("reason", ""))).data)

    @action(detail=True, methods=("get",), url_path="stage-history")
    def stage_history(self, request, pk=None):
        history = ApplicationStageHistory.objects.for_institution(request.institution).filter(application=self.get_object()).select_related("from_stage", "to_stage", "changed_by")
        return Response(ApplicationStageHistorySerializer(history, many=True).data)

    @action(detail=False, methods=("get",))
    def pipeline(self, request):
        return Response(recruitment_pipeline(institution=request.institution))


class InterviewViewSet(RecruitmentViewSet):
    model = Interview
    serializer_class = InterviewSerializer
    permission_resource = "interview"
    # Records are kept for audit: no hard DELETE route (W0-API-02).
    http_method_names = ("get", "post", "put", "patch", "head", "options")
    filterset_fields = ("application", "interviewer", "status", "scheduled_at")
    search_fields = ("application__candidate__first_name", "application__candidate__last_name", "interview_type")
    ordering_fields = ("scheduled_at", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related("application__candidate", "application__job_posting", "interviewer").prefetch_related("panel")

    @action(detail=False, methods=("get",))
    def availability(self, request):
        from datetime import date as date_type

        try:
            day = date_type.fromisoformat(request.query_params.get("date", ""))
            duration = int(request.query_params.get("duration", 60))
        except ValueError:
            from rest_framework.exceptions import ValidationError as DRFValidationError

            raise DRFValidationError({"date": "Use YYYY-MM-DD and a whole number of minutes."})
        ids = [value for value in request.query_params.get("interviewers", "").split(",") if value]
        return Response(call_validated_service(
            interview_availability, institution=request.institution, day=day, interviewer_ids=ids, duration_minutes=duration,
            time_zone=request.query_params.get("time_zone", "UTC"), exclude_interview=request.query_params.get("exclude") or None,
        ))

    def _schedule(self, request, interview=None):
        from django.contrib.auth import get_user_model

        payload = InterviewScheduleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        application = Application.objects.for_institution(request.institution).filter(pk=data["application"]).first()
        if application is None:
            raise NotFound("Application not found.")
        users = {str(user.id): user for user in get_user_model().objects.filter(pk__in=data["panel"])}
        created = interview is None
        interview = call_validated_service(
            schedule_interview, application=application, actor=request.user, interview=interview,
            scheduled_at=data["scheduled_at"], duration_minutes=data["duration_minutes"], interview_stage=data["interview_stage"],
            mode=data["mode"], time_zone=data["time_zone"], location_or_link=data.get("location_or_link", ""), agenda=data.get("agenda", ""),
            panel=[users.get(str(value)) for value in data["panel"]], candidate_message=data.get("candidate_message", ""),
            draft=data["draft"], send_invitation=data["send_invitation"],
        )
        return Response(self.get_serializer(interview).data, status=201 if created else 200)

    @action(detail=False, methods=("post",))
    def schedule(self, request):
        return self._schedule(request)

    @action(detail=True, methods=("post",), url_path="reschedule")
    def reschedule(self, request, pk=None):
        return self._schedule(request, interview=self.get_object())

    @action(detail=True, methods=("post",), url_path="set-status")
    def set_status(self, request, pk=None):
        payload = InterviewStatusSerializer(data=request.data); payload.is_valid(raise_exception=True)
        interview = call_validated_service(update_interview_status, interview=self.get_object(), actor=request.user, status=payload.validated_data["status"])
        return Response(self.get_serializer(interview).data)

    def get_required_permission(self):
        if self.action in {"set_status", "schedule", "reschedule", "availability"}:
            return "interview.manage"
        return super().get_required_permission()


class CandidateEvaluationViewSet(RecruitmentViewSet):
    model = CandidateEvaluation
    serializer_class = CandidateEvaluationSerializer
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("application", "interviewer", "recommendation")
    ordering_fields = ("score", "created_at")

    def get_required_permission(self):
        return "candidate_evaluation.create" if self.action == "create" else "interview.view"


class OfferViewSet(RecruitmentViewSet):
    model = Offer
    serializer_class = OfferSerializer
    permission_resource = "offer"
    # Records are kept for audit: no hard DELETE route (W0-API-02).
    http_method_names = ("get", "post", "put", "patch", "head", "options")
    filterset_fields = ("application", "status", "department", "position", "proposed_start_date")
    search_fields = ("application__candidate__first_name", "application__candidate__last_name", "application__job_posting__title")
    ordering_fields = ("proposed_start_date", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related("application__candidate", "application__job_posting", "department", "position", "grade", "location", "salary_structure", "hired_employee", "reports_to", "submitted_by", "approved_by", "response_recorded_by")

    def get_required_permission(self):
        return {
            "extend": "offer.create", "accept": "offer.manage", "decline": "offer.manage", "withdraw": "offer.manage", "hire": "offer.manage",
            "submit_approval": "offer.create", "generate_letter": "offer.create", "approve": "offer.approve", "return_for_changes": "offer.approve",
            "activity": "offer.view", "update": "offer.create", "partial_update": "offer.create",
        }.get(self.action, super().get_required_permission())

    @action(detail=True, methods=("post",), url_path="submit-approval")
    def submit_approval(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(submit_offer_for_approval, offer=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        payload = RequisitionDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(approve_offer, offer=self.get_object(), actor=request.user, comment=payload.validated_data.get("comment", ""))).data)

    @action(detail=True, methods=("post",), url_path="return")
    def return_for_changes(self, request, pk=None):
        payload = RequisitionDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(return_offer, offer=self.get_object(), actor=request.user, comment=payload.validated_data.get("comment", ""))).data)

    @action(detail=True, methods=("post",), url_path="generate-letter")
    def generate_letter(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(generate_offer_letter, offer=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("get",))
    def activity(self, request, pk=None):
        from apps.audit.models import AuditLog

        offer = self.get_object()
        entries = AuditLog.objects.filter(institution=request.institution, entity_id=offer.id).select_related("actor").order_by("-created_at")[:50]
        return Response([
            {"id": str(entry.id), "action": entry.action, "actor": (entry.actor.get_full_name() or entry.actor.email) if entry.actor else "System", "created_at": entry.created_at, "metadata": entry.metadata}
            for entry in entries
        ])

    @action(detail=True, methods=("post",))
    def extend(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(extend_offer, offer=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def accept(self, request, pk=None):
        payload = OfferResponseSerializer(data=request.data); payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(decide_offer, offer=self.get_object(), actor=request.user, accepted=True, note=payload.validated_data.get("note", ""))).data)

    @action(detail=True, methods=("post",))
    def decline(self, request, pk=None):
        payload = OfferResponseSerializer(data=request.data); payload.is_valid(raise_exception=True)
        return Response(self.get_serializer(call_validated_service(decide_offer, offer=self.get_object(), actor=request.user, accepted=False, note=payload.validated_data.get("note", ""))).data)

    @action(detail=True, methods=("post",))
    def withdraw(self, request, pk=None):
        return Response(self.get_serializer(call_validated_service(withdraw_offer, offer=self.get_object(), actor=request.user)).data)

    @action(detail=True, methods=("post",))
    def hire(self, request, pk=None):
        payload = HireCandidateSerializer(data=request.data); payload.is_valid(raise_exception=True)
        employee = call_validated_service(hire_candidate, offer=self.get_object(), actor=request.user, employee_number=payload.validated_data["employee_number"])
        return Response({"employee_id": employee.id, "employee_number": employee.employee_number})
