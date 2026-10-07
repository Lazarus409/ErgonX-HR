from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.leave.models import LeaveApproval, LeaveBalance, LeavePolicy, LeaveRequest, LeaveType
from apps.leave.serializers import (
    ApprovalCommentSerializer,
    AccrualSerializer,
    CarryForwardSerializer,
    LeaveApprovalSerializer,
    LeaveBalanceSerializer,
    LeaveCommentCreateSerializer,
    LeaveDelegateSerializer,
    LeaveRequestCommentSerializer,
    LeavePolicySerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)
from apps.leave.services import (
    approve_leave_request,
    accrue_leave_balance,
    carry_forward_leave_balance,
    add_leave_comment,
    cancel_leave_request,
    delegate_leave_approval,
    leave_review_context,
    reject_leave_request,
    request_leave_changes,
    submit_leave_request,
)
from common.scoping import LEAVE_BROAD, scope_to_employees, sees_everyone
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class LeavePermissionMixin:
    required_module = "LEAVE"

    def get_required_permission(self):
        if self.action in {"list", "retrieve"}:
            return "leave.view"
        return "leave.configure"


class LeaveTypeViewSet(LeavePermissionMixin, TenantModelViewSet):
    model = LeaveType
    serializer_class = LeaveTypeSerializer
    search_fields = ("name", "code")
    ordering_fields = ("name", "code", "created_at", "updated_at")


class LeavePolicyViewSet(LeavePermissionMixin, TenantModelViewSet):
    model = LeavePolicy
    serializer_class = LeavePolicySerializer
    search_fields = ("name", "leave_type__name", "leave_type__code")
    ordering_fields = ("effective_from", "name", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related("leave_type")


class LeaveBalanceViewSet(TenantModelViewSet):
    model = LeaveBalance
    serializer_class = LeaveBalanceSerializer
    required_module = "LEAVE"
    filterset_fields = ("employee", "leave_type", "year")
    ordering_fields = ("year", "created_at", "updated_at")

    def get_required_permission(self):
        if self.action in {"list", "retrieve"}:
            return "leave.view"
        return "leave.balance.manage"

    def get_queryset(self):
        queryset = super().get_queryset().select_related("employee", "leave_type")
        return scope_to_employees(queryset, self.request, broad=LEAVE_BROAD)

    @action(detail=True, methods=("post",))
    def accrue(self, request, pk=None):
        payload = AccrualSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        balance = call_validated_service(
            accrue_leave_balance,
            balance=self.get_object(),
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(balance).data)

    @action(detail=True, methods=("post",), url_path="carry-forward")
    def carry_forward(self, request, pk=None):
        payload = CarryForwardSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        balance = call_validated_service(
            carry_forward_leave_balance,
            balance=self.get_object(),
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(balance).data)


class LeaveRequestViewSet(TenantModelViewSet):
    model = LeaveRequest
    serializer_class = LeaveRequestSerializer
    required_module = "LEAVE"
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("employee", "leave_type", "status", "start_date", "end_date")
    search_fields = ("employee__employee_number", "employee__first_name", "employee__last_name")
    ordering_fields = ("start_date", "end_date", "created_at", "updated_at")

    def get_required_permission(self):
        return {
            "create": "leave.request",
            "submit": "leave.request",
            "cancel": "leave.request",
            "approve": "leave.approve",
            "reject": "leave.reject",
            "partial_update": "leave.request",
            "request_changes": "leave.approve",
            "delegate": "leave.approve",
            "delegates": "leave.approve",
        }.get(self.action, "leave.view")

    def get_queryset(self):
        queryset = scope_to_employees(
            super().get_queryset().select_related("employee", "leave_type", "attachment"), self.request, broad=LEAVE_BROAD
        )
        if self.action == "calendar":
            queryset = queryset.filter(
                status__in=(LeaveRequest.Status.PENDING, LeaveRequest.Status.APPROVED)
            )
            date_from = self.request.query_params.get("date_from")
            date_to = self.request.query_params.get("date_to")
            if date_from:
                parsed = parse_date(date_from)
                if parsed is None:
                    raise ValidationError({"date_from": "Use YYYY-MM-DD."})
                queryset = queryset.filter(end_date__gte=parsed)
            if date_to:
                parsed = parse_date(date_to)
                if parsed is None:
                    raise ValidationError({"date_to": "Use YYYY-MM-DD."})
                queryset = queryset.filter(start_date__lte=parsed)
        return queryset

    @action(detail=False, methods=("get",))
    def calendar(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(queryset, many=True).data)

    @action(detail=True, methods=("post",))
    def submit(self, request, pk=None):
        instance = call_validated_service(
            submit_leave_request, leave_request=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=("post",))
    def cancel(self, request, pk=None):
        instance = call_validated_service(
            cancel_leave_request, leave_request=self.get_object(), actor=request.user
        )
        return Response(self.get_serializer(instance).data)

    def _decision(self, request, service):
        payload = ApprovalCommentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        instance = call_validated_service(
            service,
            leave_request=self.get_object(),
            actor=request.user,
            comment=payload.validated_data.get("comment", ""),
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        return self._decision(request, approve_leave_request)

    @action(detail=True, methods=("post",))
    def reject(self, request, pk=None):
        return self._decision(request, reject_leave_request)

    @action(detail=True, methods=("post",), url_path="request-changes")
    def request_changes(self, request, pk=None):
        return self._decision(request, request_leave_changes)

    @action(detail=True, methods=("post",))
    def delegate(self, request, pk=None):
        payload = LeaveDelegateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        from django.contrib.auth import get_user_model

        delegate_user = get_user_model().objects.filter(pk=payload.validated_data["delegate"]).first()
        instance = call_validated_service(
            delegate_leave_approval,
            leave_request=self.get_object(),
            actor=request.user,
            delegate=delegate_user,
            comment=payload.validated_data.get("comment", ""),
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=("get",))
    def delegates(self, request, pk=None):
        """Active members who may take over the current approval step."""
        from apps.institutions.models import InstitutionMembership

        leave_request = self.get_object()
        current = leave_request.approvals.filter(status=LeaveApproval.Status.PENDING).order_by("sequence").first()
        members = (
            InstitutionMembership.objects.filter(
                institution=request.institution,
                status=InstitutionMembership.Status.ACTIVE,
                role__permissions__code="leave.approve",
            )
            .exclude(user_id=leave_request.employee.user_id)
            .select_related("user", "role")
            .distinct()
            .order_by("user__first_name", "user__last_name")
        )
        if current:
            members = members.exclude(user_id=current.approver_id)
        return Response([
            {"id": str(item.user_id), "name": item.user.get_full_name() or item.user.email, "role": item.role.name}
            for item in members
        ])

    @action(detail=True, methods=("get", "post"))
    def comments(self, request, pk=None):
        leave_request = self.get_object()
        if request.method == "POST":
            payload = LeaveCommentCreateSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            comment = call_validated_service(
                add_leave_comment, leave_request=leave_request, actor=request.user, body=payload.validated_data["body"]
            )
            return Response(LeaveRequestCommentSerializer(comment).data, status=201)
        comments = leave_request.comments.select_related("author").order_by("created_at")
        return Response(LeaveRequestCommentSerializer(comments, many=True).data)

    @action(detail=True, methods=("get",))
    def review(self, request, pk=None):
        return Response(leave_review_context(leave_request=self.get_object(), user=request.user))


class LeaveApprovalViewSet(TenantModelViewSet):
    model = LeaveApproval
    serializer_class = LeaveApprovalSerializer
    required_module = "LEAVE"
    http_method_names = ("get", "head", "options")
    filterset_fields = ("leave_request", "approver", "status")
    ordering_fields = ("sequence", "acted_at", "created_at")

    def get_required_permission(self):
        return "leave.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related("leave_request", "approver")
        if sees_everyone(self.request, LEAVE_BROAD):
            return queryset
        visible = scope_to_employees(queryset, self.request, "leave_request__employee", broad=LEAVE_BROAD).values("pk")
        return queryset.filter(Q(pk__in=visible) | Q(approver=self.request.user))
