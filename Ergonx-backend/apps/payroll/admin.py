from django.contrib import admin

from apps.payroll.models import (
    ComplianceDeadline,
    ContributionAllocation,
    ContributionRule,
    EmployeeTaxReliefClaim,
    EmployeePayrollProfile,
    InstitutionPayrollConfiguration,
    PayrollAdjustment,
    PayrollItem,
    PayrollPeriod,
    PayrollPreset,
    PayrollPresetVersion,
    PayrollRecord,
    PayrollRun,
    Payslip,
    SpecialIncomeRule,
    StatutoryThreshold,
    TaxBand,
    TaxReliefDefinition,
    TaxRule,
)


admin.site.register(
    [
        InstitutionPayrollConfiguration,
        PayrollPreset,
        PayrollPresetVersion,
        TaxRule,
        TaxBand,
        ContributionRule,
        ContributionAllocation,
        SpecialIncomeRule,
        TaxReliefDefinition,
        EmployeeTaxReliefClaim,
        EmployeePayrollProfile,
        StatutoryThreshold,
        ComplianceDeadline,
        PayrollPeriod,
        PayrollRun,
        PayrollRecord,
        PayrollItem,
        PayrollAdjustment,
        Payslip,
    ]
)
