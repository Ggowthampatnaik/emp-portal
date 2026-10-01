from rest_framework.routers import DefaultRouter

from apps.payroll import views

app_name = "payroll"

router = DefaultRouter()
router.register("salary-structures", views.SalaryStructureViewSet, basename="salary-structure")
router.register("payroll-runs", views.PayrollRunViewSet, basename="payroll-run")
router.register("payslips", views.PayslipViewSet, basename="payslip")

urlpatterns = router.urls
