from rest_framework.routers import DefaultRouter

from apps.leave.views import (
    LeaveApprovalViewSet,
    LeaveBalanceViewSet,
    LeavePolicyViewSet,
    LeaveRequestViewSet,
    LeaveTypeViewSet,
)


router = DefaultRouter()
router.register("leave-types", LeaveTypeViewSet, basename="leave-type")
router.register("leave-policies", LeavePolicyViewSet, basename="leave-policy")
router.register("leave-balances", LeaveBalanceViewSet, basename="leave-balance")
router.register("leave-requests", LeaveRequestViewSet, basename="leave-request")
router.register("leave-approvals", LeaveApprovalViewSet, basename="leave-approval")

urlpatterns = router.urls
