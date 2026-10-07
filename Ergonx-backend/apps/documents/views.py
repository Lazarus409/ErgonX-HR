from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Q
from django.http import FileResponse
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied

from apps.documents.models import Document, ImageAsset
from apps.documents.serializers import DocumentSerializer, ImageAssetSerializer
from apps.employees.models import Employee
from common.scoping import LEAVE_BROAD, scope_to_employees
from common.viewsets import TenantModelViewSet


class DocumentViewSet(TenantModelViewSet):
    model = Document
    serializer_class = DocumentSerializer
    permission_resource = "document"
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ("category", "classification", "entity_type", "entity_id", "is_active")
    search_fields = ("original_filename", "category", "entity_type")

    @property
    def required_module(self):
        category = self.request.data.get("category")
        if not category and self.kwargs.get("pk"):
            category = Document.objects.filter(id=self.kwargs["pk"], institution=self.request.institution).values_list("category", flat=True).first()
        if category == "LEAVE_SUPPORTING":
            return "LEAVE"
        return "ACCOUNTING" if category == "EXPENSE_RECEIPT" else None

    def get_required_permission(self):
        # Employee self-service may upload only a supporting document for its
        # own leave workflow; all other document creation remains governed by
        # the institution's document.create permission.
        category = self.request.data.get("category")
        if self.kwargs.get("pk") and not category:
            category = Document.objects.filter(id=self.kwargs["pk"], institution=self.request.institution).values_list("category", flat=True).first()
        if category == "LEAVE_SUPPORTING":
            if self.action in ("create", "retrieve", "download"):
                return "leave.request" if self.action == "create" else "leave.view"
        if category == "EXPENSE_RECEIPT" and self.action in ("create", "retrieve", "download"):
            # Receipts for expense claims (Wave 6): claimants upload their own;
            # finance reads them through expense.view.
            from apps.institutions.services import effective_permission_codes

            held = effective_permission_codes(getattr(self.request, "membership", None))
            return "expense.view" if self.action != "create" and "expense.view" in held else "expense.claim_own"
        if self.action == "download":
            return "document.view"
        return super().get_required_permission()

    def get_queryset(self):
        queryset = super().get_queryset()
        membership = getattr(self.request, "membership", None)
        if membership is not None and membership.role.permissions.filter(code="document.view").exists():
            return queryset
        # Reached through leave permissions only: a supporting document is visible
        # to its uploader and to whoever can see or approve the request it supports.
        from apps.leave.models import LeaveRequest

        visible_requests = scope_to_employees(
            LeaveRequest.objects.for_institution(self.request.institution), self.request, broad=LEAVE_BROAD
        ).values("pk")
        leave_documents = Q(category="LEAVE_SUPPORTING") & (
            Q(uploaded_by=self.request.user)
            | Q(leave_requests__in=visible_requests)
            | Q(leave_requests__approvals__approver=self.request.user)
        )
        # Expense receipts: the uploader, the claimant and the claim's approvers;
        # finance (expense.view) sees every receipt.
        if membership is not None and membership.role.permissions.filter(code="expense.view").exists():
            receipt_documents = Q(category="EXPENSE_RECEIPT")
        else:
            receipt_documents = Q(category="EXPENSE_RECEIPT") & (
                Q(uploaded_by=self.request.user)
                | Q(expense_lines__expense__claimant__user=self.request.user)
                | Q(expense_lines__expense__approvals__approver=self.request.user)
            )
        return queryset.filter(leave_documents | receipt_documents).distinct()

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, uploaded_by=self.request.user)

    @action(detail=True, methods=("get",), url_path="download")
    def download(self, request, pk=None):
        document = self.get_object()
        if not document.stored_file:
            raise NotFound("This document has no managed file content.")
        response = FileResponse(
            document.stored_file.open("rb"),
            as_attachment=True,
            filename=document.original_filename,
            content_type=document.content_type or "application/octet-stream",
        )
        response["X-Content-Type-Options"] = "nosniff"
        return response


class ImageAssetViewSet(TenantModelViewSet):
    model = ImageAsset
    serializer_class = ImageAssetSerializer
    permission_resource = "image"
    filter_backends = (DjangoFilterBackend,)
    filterset_fields = ("owner_type", "owner_id")
    http_method_names = ("get", "post", "delete", "head", "options")

    def get_queryset(self):
        # filter_backends omits OrderingFilter, so order explicitly for stable pagination.
        return super().get_queryset().filter(is_active=True).order_by("-created_at", "id")

    @property
    def required_module(self):
        owner_type = self.request.data.get("owner_type")
        if not owner_type and self.kwargs.get("pk"):
            owner_type = ImageAsset.objects.filter(id=self.kwargs["pk"], institution=self.request.institution).values_list("owner_type", flat=True).first()
        return "CORE_HR" if owner_type == ImageAsset.OwnerType.EMPLOYEE else None

    def get_required_permission(self):
        owner_type = self.request.data.get("owner_type")
        owner_id = str(self.request.data.get("owner_id") or "")
        if self.kwargs.get("pk") and not owner_type:
            asset = ImageAsset.objects.filter(id=self.kwargs["pk"], institution=self.request.institution).values("owner_type", "owner_id").first()
            if asset:
                owner_type = asset["owner_type"]
                owner_id = str(asset["owner_id"])
        if owner_type == ImageAsset.OwnerType.USER and owner_id == str(self.request.user.id):
            return "home.view"
        if owner_type == ImageAsset.OwnerType.EMPLOYEE and Employee.objects.for_institution(self.request.institution).filter(id=owner_id, user=self.request.user).exists():
            return "home.view"
        if owner_type == ImageAsset.OwnerType.INSTITUTION and owner_id == str(self.request.institution.id):
            # Every member sees the institution logo in the shell and on
            # documents; only institution managers may replace or remove it.
            if self.action in ("retrieve", "content"):
                return "home.view"
            return "settings.institution.manage"
        return "employee.update"

    def perform_create(self, serializer):
        values = serializer.validated_data
        owner_type = values["owner_type"]
        owner_id = values["owner_id"]
        if owner_type == ImageAsset.OwnerType.USER and owner_id != self.request.user.id:
            raise PermissionDenied("A user image may only be managed for the signed-in account.")
        if owner_type == ImageAsset.OwnerType.INSTITUTION and owner_id != self.request.institution.id:
            raise PermissionDenied("The institution image must belong to the active institution.")
        if owner_type == ImageAsset.OwnerType.EMPLOYEE:
            employee = Employee.objects.for_institution(self.request.institution).filter(id=owner_id).first()
            if employee is None:
                raise NotFound("Employee image target was not found.")
        ImageAsset.objects.filter(institution=self.request.institution, owner_type=owner_type, owner_id=owner_id, is_active=True).update(is_active=False)
        serializer.save(institution=self.request.institution)

    @action(detail=True, methods=("get",), url_path="content")
    def content(self, request, pk=None):
        image = self.get_object()
        response = FileResponse(image.stored_file.open("rb"), content_type=image.content_type)
        response["Cache-Control"] = "private, no-store"
        return response

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=("is_active", "updated_at"))

