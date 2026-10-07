from django.contrib import admin

from apps.leave.models import (
    LeaveApproval,
    LeaveBalance,
    LeavePolicy,
    LeavePolicyDepartmentEligibility,
    LeavePolicyEmploymentTypeEligibility,
    LeavePolicyGenderEligibility,
    LeavePolicyGradeEligibility,
    LeavePolicyLocationEligibility,
    LeaveRequest,
    LeaveType,
)


admin.site.register(
    [
        LeaveType,
        LeavePolicy,
        LeavePolicyDepartmentEligibility,
        LeavePolicyGradeEligibility,
        LeavePolicyLocationEligibility,
        LeavePolicyEmploymentTypeEligibility,
        LeavePolicyGenderEligibility,
        LeaveBalance,
        LeaveRequest,
        LeaveApproval,
    ]
)
