from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from apps.audit.services import record_audit_event
from apps.employees.models import Employee
from apps.performance.models import Competency, PerformanceReview, ReviewCycle
from apps.performance.serializers import (
    CompetencySerializer,
    LaunchSerializer,
    ManagerReviewSerializer,
    PerformanceReviewListSerializer,
    PerformanceReviewSerializer,
    ReviewCycleSerializer,
    SelfAssessmentSerializer,
    ratings_map,
)
from apps.performance.services import (
    cancel_review,
    close_cycle,
    cycle_summary,
    launch_cycle,
    reassign_reviewer,
    release_to_reviewer,
    return_to_reviewer,
    save_manager_review,
    save_self_assessment,
    sign_off,
)
from common.scoping import permission_codes, scope_to_employees
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet

READ = ("list", "retrieve", "summary")


class CompetencyViewSet(TenantModelViewSet):
    model = Competency
    serializer_class = CompetencySerializer
    http_method_names = ("get", "post", "patch", "delete", "head", "options")
    filterset_fields = ("is_active",)
    ordering_fields = ("sort_order", "name")
    ordering = ("sort_order", "name")

    def get_required_permission(self):
        return "performance.view" if self.action in READ else "performance.manage"


class ReviewCycleViewSet(TenantModelViewSet):
    model = ReviewCycle
    serializer_class = ReviewCycleSerializer
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("status",)
    ordering_fields = ("period_end", "created_at", "name")
    ordering = ("-period_end", "-created_at")

    def get_required_permission(self):
        return "performance.view" if self.action in READ else "performance.manage"

    def get_queryset(self):
        return super().get_queryset().prefetch_related("competencies").annotate(
            review_count=Count("reviews", filter=~Q(reviews__status=PerformanceReview.Status.CANCELLED)),
            completed_count=Count("reviews", filter=Q(reviews__status=PerformanceReview.Status.COMPLETED)),
        )

    def perform_create(self, serializer):
        cycle = serializer.save(institution=self.request.institution)
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=cycle, action="performance.cycle.created", metadata={"name": cycle.name})

    def perform_update(self, serializer):
        if serializer.instance.status != ReviewCycle.Status.DRAFT:
            raise serializers.ValidationError({"status": "Only a draft cycle can be edited."})
        serializer.save()

    @extend_schema(request=LaunchSerializer, responses=ReviewCycleSerializer)
    @action(detail=True, methods=("post",))
    def launch(self, request, pk=None):
        cycle = self.get_object()
        payload = LaunchSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        employees = Employee.objects.for_institution(request.institution).filter(status=Employee.Status.ACTIVE)
        if values.get("departments"):
            employees = employees.filter(employments__is_current=True, employments__department_id__in=values["departments"])
        elif not values.get("all_active"):
            employees = employees.filter(id__in=values.get("employees") or [])
        call_validated_service(launch_cycle, cycle=cycle, actor=request.user, employees=list(employees.distinct()))
        return Response(ReviewCycleSerializer(self.get_queryset().get(pk=cycle.pk), context={"request": request}).data)

    @extend_schema(request=None, responses=ReviewCycleSerializer)
    @action(detail=True, methods=("post",))
    def close(self, request, pk=None):
        cycle = call_validated_service(close_cycle, cycle=self.get_object(), actor=request.user)
        return Response(ReviewCycleSerializer(self.get_queryset().get(pk=cycle.pk), context={"request": request}).data)

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=True, methods=("get",))
    def summary(self, request, pk=None):
        cycle = self.get_object()
        reviews = scope_to_employees(PerformanceReview.objects.for_institution(request.institution).filter(cycle=cycle), request)
        return Response(cycle_summary(reviews))


class PerformanceReviewViewSet(TenantModelViewSet):
    """Reviews visible to the caller: HR sees its scope, reviewers their reviewees, everyone their own."""

    model = PerformanceReview
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("cycle", "status", "employee", "reviewer")
    search_fields = ("employee__first_name", "employee__last_name", "employee__employee_number")
    ordering_fields = ("employee__last_name", "status", "overall_rating", "created_at")
    ordering = ("employee__last_name", "employee__first_name")

    def is_hr(self):
        return "performance.view" in permission_codes(self.request) or "performance.manage" in permission_codes(self.request)

    def get_serializer_class(self):
        return PerformanceReviewListSerializer if self.action == "list" else PerformanceReviewSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "is_hr": self.is_hr()}

    def get_required_permission(self):
        if self.action in ("list", "retrieve", "self_assessment", "manager_review"):
            # Rows are limited in get_queryset; the service checks that the caller is
            # the employee (self-assessment) or the assigned reviewer (manager review).
            return "home.view"
        return "performance.manage"

    def get_queryset(self):
        queryset = super().get_queryset().select_related("cycle", "employee", "reviewer", "signed_off_by")
        own = Q(employee__user=self.request.user) | Q(reviewer=self.request.user)
        if self.is_hr():
            scoped = scope_to_employees(queryset, self.request).values("pk")
            queryset = queryset.filter(Q(pk__in=scoped) | own)
        else:
            queryset = queryset.filter(own)
        mine = self.request.query_params.get("mine")
        if mine == "employee":
            queryset = queryset.filter(employee__user=self.request.user)
        elif mine == "reviewer":
            queryset = queryset.filter(reviewer=self.request.user)
        return queryset.distinct()

    def _respond(self, review):
        review = self.get_queryset().get(pk=review.pk)
        return Response(PerformanceReviewSerializer(review, context=self.get_serializer_context()).data)

    @extend_schema(request=SelfAssessmentSerializer, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="self-assessment")
    def self_assessment(self, request, pk=None):
        payload = SelfAssessmentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        review = call_validated_service(save_self_assessment, review=self.get_object(), actor=request.user, ratings=ratings_map(values.get("ratings")), summary=values.get("summary"), submit=values["submit"])
        return self._respond(review)

    @extend_schema(request=ManagerReviewSerializer, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="manager-review")
    def manager_review(self, request, pk=None):
        payload = ManagerReviewSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        review = call_validated_service(
            save_manager_review, review=self.get_object(), actor=request.user, ratings=ratings_map(values.get("ratings")), summary=values.get("summary"),
            development_plan=values.get("development_plan"), overall_rating=values.get("overall_rating"), submit=values["submit"],
        )
        return self._respond(review)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="sign-off")
    def sign_off(self, request, pk=None):
        return self._respond(call_validated_service(sign_off, review=self.get_object(), actor=request.user, comment=str(request.data.get("comment") or "")))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="return")
    def return_review(self, request, pk=None):
        return self._respond(call_validated_service(return_to_reviewer, review=self.get_object(), actor=request.user, comment=str(request.data.get("comment") or "")))

    @extend_schema(request=None, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="release")
    def release(self, request, pk=None):
        return self._respond(call_validated_service(release_to_reviewer, review=self.get_object(), actor=request.user))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="reassign")
    def reassign(self, request, pk=None):
        reviewer = get_object_or_404(User, pk=request.data.get("reviewer"))
        return self._respond(call_validated_service(reassign_reviewer, review=self.get_object(), actor=request.user, reviewer=reviewer))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=PerformanceReviewSerializer)
    @action(detail=True, methods=("post",), url_path="cancel")
    def cancel(self, request, pk=None):
        return self._respond(call_validated_service(cancel_review, review=self.get_object(), actor=request.user, reason=str(request.data.get("reason") or "")))
