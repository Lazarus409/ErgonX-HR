from rest_framework.routers import DefaultRouter

from apps.payroll.views import (
    ComplianceDeadlineViewSet,
    ContributionAllocationViewSet,
    ContributionRuleViewSet,
    EmployeeTaxReliefClaimViewSet,
    EmployeePayrollProfileViewSet,
    InstitutionPayrollConfigurationViewSet,
    PayrollAdjustmentViewSet,
    PayrollItemViewSet,
    PayrollPeriodViewSet,
    PayrollPresetVersionViewSet,
    PayrollPresetViewSet,
    PayrollRecordViewSet,
    PayrollRunViewSet,
    PayslipViewSet,
    SpecialIncomeRuleViewSet,
    StatutoryThresholdViewSet,
    TaxBandViewSet,
    TaxReliefDefinitionViewSet,
    TaxRuleViewSet,
)


router = DefaultRouter()
router.register("payroll-presets", PayrollPresetViewSet, basename="payroll-preset")
router.register(
    "payroll-preset-versions",
    PayrollPresetVersionViewSet,
    basename="payroll-preset-version",
)
router.register("tax-rules", TaxRuleViewSet, basename="tax-rule")
router.register("tax-bands", TaxBandViewSet, basename="tax-band")
router.register("contribution-rules", ContributionRuleViewSet, basename="contribution-rule")
router.register(
    "contribution-allocations",
    ContributionAllocationViewSet,
    basename="contribution-allocation",
)
router.register(
    "special-income-rules", SpecialIncomeRuleViewSet, basename="special-income-rule"
)
router.register(
    "tax-relief-definitions",
    TaxReliefDefinitionViewSet,
    basename="tax-relief-definition",
)
router.register(
    "statutory-thresholds", StatutoryThresholdViewSet, basename="statutory-threshold"
)
router.register(
    "compliance-deadlines", ComplianceDeadlineViewSet, basename="compliance-deadline"
)
router.register(
    "payroll-configurations",
    InstitutionPayrollConfigurationViewSet,
    basename="payroll-configuration",
)
router.register(
    "employee-payroll-profiles",
    EmployeePayrollProfileViewSet,
    basename="employee-payroll-profile",
)
router.register("payroll-periods", PayrollPeriodViewSet, basename="payroll-period")
router.register("payroll-runs", PayrollRunViewSet, basename="payroll-run")
router.register("payroll-records", PayrollRecordViewSet, basename="payroll-record")
router.register("payroll-items", PayrollItemViewSet, basename="payroll-item")
router.register(
    "payroll-adjustments", PayrollAdjustmentViewSet, basename="payroll-adjustment"
)
router.register(
    "employee-tax-relief-claims",
    EmployeeTaxReliefClaimViewSet,
    basename="employee-tax-relief-claim",
)
router.register("payslips", PayslipViewSet, basename="payslip")

urlpatterns = router.urls
