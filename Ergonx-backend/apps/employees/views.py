from datetime import timedelta
from smtplib import SMTPException

from django.conf import settings
from django.core.mail import BadHeaderError
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser

from apps.employees.filters import EmergencyContactFilter, EmployeeFilter
from apps.employees.models import EmergencyContact, Employee, EmployeeOffboarding, EmployeeOnboarding, Employment
from apps.employees.selectors import employment_history_for_employee
from apps.employees.serializers import EmergencyContactSerializer, EmployeeOffboardingSerializer, EmployeeOffboardingStartSerializer, EmployeeOnboardingSerializer, EmployeeRehireSerializer, EmployeeSelfServiceInvitationSerializer, NewEmployeeSelfServiceInvitationSerializer, EmployeeSerializer, EmploymentSerializer, SelfServiceProfileSerializer
from apps.employees.services import complete_employee_offboarding, complete_employee_onboarding, ensure_not_self_hr_mutation, initiate_employee_offboarding, rehire_employee, start_employee_onboarding
from apps.accounts.emails import send_employee_self_service_invitation
from apps.institutions.models import Role
from apps.institutions.services import create_invitation, record_user_activity
from apps.organization.models import Department, Grade, Location, Position
from apps.documents.models import EMPLOYEE_ENTITY_TYPE, Document, DocumentRequirement
from apps.documents.serializers import DocumentSerializer
from apps.audit.services import field_changes, record_audit_event, snapshot
from common.scoping import scope_to_employees
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet
from common.permissions import TenantContextPermission, TenantRBACPermission


class SelfServiceBaseView(APIView):
    permission_classes = (TenantContextPermission, TenantRBACPermission)

    def get_required_permission(self):
        return "home.view"

    def employee(self, request):
        return get_object_or_404(Employee.objects.for_institution(request.institution), user=request.user)


@extend_schema(responses=SelfServiceProfileSerializer)
class SelfServiceProfileView(SelfServiceBaseView):
    serializer_class = SelfServiceProfileSerializer
    def get(self, request):
        return Response(SelfServiceProfileSerializer(self.employee(request)).data)

    def patch(self, request):
        serializer = SelfServiceProfileSerializer(self.employee(request), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


@extend_schema(responses=EmergencyContactSerializer(many=True))
class SelfServiceEmergencyContactsView(SelfServiceBaseView):
    serializer_class = EmergencyContactSerializer
    def get(self, request):
        contacts = EmergencyContact.objects.for_institution(request.institution).filter(employee=self.employee(request))
        return Response(EmergencyContactSerializer(contacts, many=True, context={"request": request}).data)

    def post(self, request):
        employee = self.employee(request)
        serializer = EmergencyContactSerializer(data={**request.data, "employee": str(employee.id)}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        contact = serializer.save()
        return Response(EmergencyContactSerializer(contact, context={"request": request}).data, status=status.HTTP_201_CREATED)


@extend_schema(responses=EmergencyContactSerializer)
class SelfServiceEmergencyContactDetailView(SelfServiceBaseView):
    serializer_class = EmergencyContactSerializer
    def _contact(self, request, pk):
        return get_object_or_404(EmergencyContact.objects.for_institution(request.institution), pk=pk, employee=self.employee(request))

    def patch(self, request, pk):
        # Never trust an employee ID supplied by the browser. A Self-Service
        # contact must stay owned by the signed-in employee.
        employee = self.employee(request)
        serializer = EmergencyContactSerializer(
            self._contact(request, pk),
            data={**request.data, "employee": str(employee.id)},
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        contact = serializer.save()
        return Response(EmergencyContactSerializer(contact, context={"request": request}).data)

    def delete(self, request, pk):
        self._contact(request, pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Categories an employee can file their own documents under. HR-shared
# documents keep whatever category HR gave them.
SELF_SERVICE_DOCUMENT_CATEGORIES = (
    "Identification",
    "Certificate",
    "Qualification",
    "Medical",
    "Bank details",
    "Contract",
    "Other",
)


def _own_documents(request, employee):
    return Document.objects.for_institution(request.institution).filter(
        entity_type=EMPLOYEE_ENTITY_TYPE, entity_id=employee.id, is_active=True
    )


def _self_service_categories(institution):
    """The fixed self-service categories plus any active document requirement's category."""
    required = DocumentRequirement.objects.for_institution(institution).filter(is_active=True).values_list("document_category", flat=True)
    return list(dict.fromkeys((*SELF_SERVICE_DOCUMENT_CATEGORIES, *required)))


@extend_schema(responses=DocumentSerializer(many=True))
class SelfServiceDocumentsView(SelfServiceBaseView):
    """The signed-in employee's documents: shared by HR, or uploaded by themselves."""

    serializer_class = DocumentSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get(self, request):
        return Response(DocumentSerializer(_own_documents(request, self.employee(request)), many=True).data)

    def post(self, request):
        employee = self.employee(request)
        category = str(request.data.get("category") or "Other").strip()
        allowed = _self_service_categories(request.institution)
        if category not in allowed:
            raise ValidationError({"category": f"Choose one of: {', '.join(allowed)}."})
        if request.data.get("uploaded_file") is None:
            raise ValidationError({"uploaded_file": "Choose a file to upload."})
        # Ownership and classification come from the server, never the browser.
        serializer = DocumentSerializer(data={
            "uploaded_file": request.data.get("uploaded_file"),
            "category": category,
            "classification": Document.Classification.CONFIDENTIAL,
        })
        serializer.is_valid(raise_exception=True)
        document = serializer.save(
            institution=request.institution,
            uploaded_by=request.user,
            entity_type=EMPLOYEE_ENTITY_TYPE,
            entity_id=employee.id,
        )
        record_audit_event(
            actor=request.user,
            institution=request.institution,
            entity=document,
            action="employee.document.uploaded",
            metadata={"category": category, "employee_id": str(employee.id)},
        )
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)


@extend_schema(responses=DocumentSerializer)
class SelfServiceDocumentDetailView(SelfServiceBaseView):
    serializer_class = DocumentSerializer

    def _document(self, request, pk):
        return get_object_or_404(_own_documents(request, self.employee(request)), pk=pk)

    def get(self, request, pk):
        document = self._document(request, pk)
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

    def delete(self, request, pk):
        document = self._document(request, pk)
        # Employees may withdraw what they uploaded; documents HR shared stay.
        if document.uploaded_by_id != request.user.id:
            raise PermissionDenied("Only documents you uploaded can be removed.")
        document.is_active = False
        document.save(update_fields=("is_active", "updated_at"))
        record_audit_event(
            actor=request.user,
            institution=request.institution,
            entity=document,
            action="employee.document.removed",
            metadata={"category": document.category},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# Employee fields recorded in the audit trail. Personal identifiers and
# contact details are masked: the trail shows that they changed, not the values.
EMPLOYEE_AUDIT_FIELDS = (
    "employee_number", "first_name", "middle_name", "last_name", "preferred_name", "work_email",
    "personal_email", "phone", "mobile_phone", "office_location", "linkedin_url", "date_of_birth",
    "gender", "hire_date", "status", "user",
)
EMPLOYEE_MASKED_FIELDS = frozenset({"personal_email", "phone", "mobile_phone", "date_of_birth", "linkedin_url"})


class EmployeeViewSet(TenantModelViewSet):
    model = Employee
    serializer_class = EmployeeSerializer
    permission_resource = "employee"
    filterset_class = EmployeeFilter
    search_fields = (
        "employee_number",
        "first_name",
        "middle_name",
        "last_name",
        "work_email",
    )
    ordering_fields = (
        "employee_number",
        "first_name",
        "last_name",
        "hire_date",
        "created_at",
        "updated_at",
    )

    def get_queryset(self):
        return scope_to_employees(super().get_queryset().select_related("user"), self.request, "")

    def perform_create(self, serializer):
        employee = serializer.save(institution=self.request.institution)
        record_audit_event(
            actor=self.request.user, institution=self.request.institution, entity=employee, action="employee.created",
            metadata={"changes": field_changes({}, snapshot(employee, EMPLOYEE_AUDIT_FIELDS), masked=EMPLOYEE_MASKED_FIELDS)},
        )
        record_user_activity(
            actor=self.request.user,
            institution=self.request.institution,
            activity_code="employee.create",
            entity=employee,
        )

    def perform_update(self, serializer):
        ensure_not_self_hr_mutation(actor=self.request.user, employee=self.get_object())
        before = snapshot(serializer.instance, EMPLOYEE_AUDIT_FIELDS)
        employee = serializer.save()
        changes = field_changes(before, snapshot(employee, EMPLOYEE_AUDIT_FIELDS), masked=EMPLOYEE_MASKED_FIELDS)
        if changes:
            record_audit_event(actor=self.request.user, institution=self.request.institution, entity=employee, action="employee.updated", metadata={"changes": changes})

    def get_required_permission(self):
        if self.action == "me":
            return "home.view"
        if self.action in ("employment_history", "lifecycle"):
            return "employment.view"
        if self.action in ("onboarding_start", "onboarding_complete", "offboarding_start", "offboarding_complete", "rehire", "invite_self_service", "invite_new_self_service"):
            return "employee.update"
        return super().get_required_permission()

    def perform_destroy(self, instance):
        ensure_not_self_hr_mutation(actor=self.request.user, employee=instance)
        previous = instance.status
        instance.status = Employee.Status.INACTIVE
        instance.save(update_fields=("status", "updated_at"))
        if previous != instance.status:
            record_audit_event(actor=self.request.user, institution=self.request.institution, entity=instance, action="employee.deactivated", metadata={"changes": {"status": [previous, instance.status]}})

    @action(detail=False, methods=("get",), url_path="me")
    def me(self, request):
        """Return only the employee record linked to the signed-in user."""
        employee = self.get_queryset().filter(user=request.user).first()
        if employee is None:
            return Response({"detail": "No employee record is linked to this account."}, status=404)
        body = dict(self.get_serializer(employee).data)
        # Read-only summary of the member's own current employment (My profile, S038).
        employment = employee.employments.filter(is_current=True).select_related("department", "position", "grade", "location", "reports_to__employee").first()
        body["current_employment"] = None if employment is None else {
            "department": employment.department.name if employment.department_id else None,
            "position": employment.position.title if employment.position_id else None,
            "grade": employment.grade.name if employment.grade_id else None,
            "location": employment.location.name if employment.location_id else None,
            "employment_type": employment.employment_type,
            "start_date": employment.start_date,
            "manager": employment.reports_to.employee.full_name if employment.reports_to_id else None,
        }
        return Response(body)

    @extend_schema(operation_id="employees_invite_new_self_service")
    @action(detail=False, methods=("post",), url_path="invite-self-service")
    def invite_new_self_service(self, request):
        """Invite a new employee before an HR employee record exists."""
        payload = NewEmployeeSelfServiceInvitationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        role = Role.objects.for_institution(request.institution).filter(code="EMPLOYEE", is_active=True).first()
        if role is None:
            return Response({"detail": "The Employee role is not configured for this institution."}, status=409)
        email = payload.validated_data["email"].strip().lower()
        expires_at = timezone.now() + timedelta(hours=payload.validated_data["expires_in_hours"])
        invitation, token = call_validated_service(
            create_invitation, email=email, institution=request.institution, role=role,
            actor=request.user, expires_at=expires_at,
        )
        delivery_status = "not_configured"
        if getattr(settings, "EMAIL_DELIVERY_ENABLED", False):
            try:
                send_employee_self_service_invitation(recipient_email=email, acceptance_token=token, institution_name=request.institution.name, expires_at=expires_at)
                delivery_status = "sent"
            except (BadHeaderError, OSError, SMTPException):
                delivery_status = "failed"
        return Response({"id": str(invitation.id), "email": email, "expires_at": expires_at, "acceptance_token": token, "email_delivery_status": delivery_status}, status=201)

    @extend_schema(operation_id="employees_invite_existing_self_service")
    @action(detail=True, methods=("post",), url_path="invite-self-service")
    def invite_self_service(self, request, pk=None):
        """Issue a one-time account activation link for this employee."""
        payload = EmployeeSelfServiceInvitationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        employee = self.get_object()
        email = employee.work_email or employee.personal_email
        if not email:
            return Response({"detail": "Add a work or personal email before inviting this employee."}, status=400)
        role = Role.objects.for_institution(request.institution).filter(code="EMPLOYEE", is_active=True).first()
        if role is None:
            return Response({"detail": "The Employee role is not configured for this institution."}, status=409)
        expires_at = timezone.now() + timedelta(hours=payload.validated_data["expires_in_hours"])
        invitation, token = call_validated_service(
            create_invitation, email=email, institution=request.institution, role=role,
            actor=request.user, expires_at=expires_at, employee=employee,
        )
        delivery_status = "not_configured"
        if getattr(settings, "EMAIL_DELIVERY_ENABLED", False):
            try:
                send_employee_self_service_invitation(
                    recipient_email=email, acceptance_token=token,
                    institution_name=request.institution.name, expires_at=expires_at,
                )
                delivery_status = "sent"
            except (BadHeaderError, OSError, SMTPException):
                delivery_status = "failed"
        return Response({
            "id": str(invitation.id), "email": email, "expires_at": expires_at,
            "acceptance_token": token, "email_delivery_status": delivery_status,
        }, status=201)

    @action(detail=True, methods=("get",), url_path="employment-history")
    def employment_history(self, request, pk=None):
        employee = self.get_object()
        history = employment_history_for_employee(
            institution=request.institution, employee=employee
        )
        page = self.paginate_queryset(history)
        if page is not None:
            serializer = EmploymentSerializer(page, many=True, context=self.get_serializer_context())
            return self.get_paginated_response(serializer.data)
        serializer = EmploymentSerializer(
            history, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=("get",), url_path="lifecycle")
    def lifecycle(self, request, pk=None):
        """Returns the latest onboarding and offboarding records for an employee."""
        employee = self.get_object()
        onboarding = EmployeeOnboarding.objects.for_institution(request.institution).filter(
            employee=employee
        ).order_by("-created_at").first()
        offboarding = EmployeeOffboarding.objects.for_institution(request.institution).filter(
            employee=employee
        ).order_by("-created_at").first()
        return Response({
            "onboarding": EmployeeOnboardingSerializer(onboarding).data if onboarding else None,
            "offboarding": EmployeeOffboardingSerializer(offboarding).data if offboarding else None,
        })

    @action(detail=True, methods=("post",), url_path="onboarding/start")
    def onboarding_start(self, request, pk=None):
        employee = self.get_object(); ensure_not_self_hr_mutation(actor=request.user, employee=employee)
        record = call_validated_service(start_employee_onboarding, institution=request.institution, employee=employee, actor=request.user)
        return Response(EmployeeOnboardingSerializer(record).data)

    @action(detail=True, methods=("post",), url_path="onboarding/complete")
    def onboarding_complete(self, request, pk=None):
        employee = self.get_object(); ensure_not_self_hr_mutation(actor=request.user, employee=employee)
        record = call_validated_service(complete_employee_onboarding, institution=request.institution, employee=employee, actor=request.user)
        return Response(EmployeeOnboardingSerializer(record).data)

    @action(detail=True, methods=("post",), url_path="offboarding/start")
    def offboarding_start(self, request, pk=None):
        payload = EmployeeOffboardingStartSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        employee = self.get_object(); ensure_not_self_hr_mutation(actor=request.user, employee=employee)
        record = call_validated_service(initiate_employee_offboarding, institution=request.institution, employee=employee, actor=request.user, **payload.validated_data)
        return Response(EmployeeOffboardingSerializer(record).data)

    @action(detail=True, methods=("post",), url_path="offboarding/complete")
    def offboarding_complete(self, request, pk=None):
        employee = self.get_object(); ensure_not_self_hr_mutation(actor=request.user, employee=employee)
        record = call_validated_service(complete_employee_offboarding, institution=request.institution, employee=employee, actor=request.user)
        return Response(EmployeeOffboardingSerializer(record).data)

    @action(detail=True, methods=("post",))
    def rehire(self, request, pk=None):
        payload = EmployeeRehireSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        institution = request.institution
        employee = self.get_object(); ensure_not_self_hr_mutation(actor=request.user, employee=employee)
        employment, onboarding = call_validated_service(
            rehire_employee, institution=institution, employee=employee, actor=request.user,
            department=Department.objects.for_institution(institution).get(pk=values["department_id"]),
            position=Position.objects.for_institution(institution).get(pk=values["position_id"]),
            grade=Grade.objects.for_institution(institution).get(pk=values["grade_id"]),
            location=Location.objects.for_institution(institution).get(pk=values["location_id"]),
            employment_type=values["employment_type"], staff_category=values["staff_category"], start_date=values["start_date"],
        )
        return Response({"employee": EmployeeSerializer(self.get_object()).data, "employment": EmploymentSerializer(employment).data, "onboarding": EmployeeOnboardingSerializer(onboarding).data})


class EmploymentViewSet(TenantModelViewSet):
    model = Employment
    serializer_class = EmploymentSerializer
    permission_resource = "employment"
    http_method_names = ("get", "post", "put", "patch", "head", "options")
    search_fields = (
        "employee__employee_number",
        "employee__first_name",
        "employee__last_name",
        "department__name",
        "position__title",
    )
    ordering_fields = ("start_date", "end_date", "created_at", "updated_at")

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "employee", "department", "position", "grade", "location", "reports_to"
        )
        return scope_to_employees(queryset, self.request)

    def perform_create(self, serializer):
        employee = serializer.validated_data.get("employee")
        if employee:
            ensure_not_self_hr_mutation(actor=self.request.user, employee=employee)
        serializer.save(institution=self.request.institution)

    def perform_update(self, serializer):
        ensure_not_self_hr_mutation(actor=self.request.user, employee=self.get_object().employee)
        serializer.save()


class EmergencyContactViewSet(TenantModelViewSet):
    model = EmergencyContact
    serializer_class = EmergencyContactSerializer
    permission_resource = "employee"
    filterset_class = EmergencyContactFilter
    search_fields = ("full_name", "relationship", "phone", "email")
    ordering_fields = ("full_name", "is_primary", "created_at", "updated_at")

    def get_queryset(self):
        # Emergency contacts are personal data: team leads see only their own.
        return scope_to_employees(super().get_queryset().select_related("employee"), self.request, allow_team=False)
