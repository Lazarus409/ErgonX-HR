from rest_framework.routers import DefaultRouter

from apps.compensation.views import (
    EmployeeCompensationViewSet,
    EmployeePayComponentViewSet,
    PayComponentViewSet,
    SalaryStructureComponentViewSet,
    SalaryStructureViewSet,
)


router = DefaultRouter()
router.register("pay-components", PayComponentViewSet, basename="pay-component")
router.register("salary-structures", SalaryStructureViewSet, basename="salary-structure")
router.register(
    "salary-structure-components",
    SalaryStructureComponentViewSet,
    basename="salary-structure-component",
)
router.register(
    "employee-compensations",
    EmployeeCompensationViewSet,
    basename="employee-compensation",
)
router.register(
    "employee-pay-components",
    EmployeePayComponentViewSet,
    basename="employee-pay-component",
)

urlpatterns = router.urls
