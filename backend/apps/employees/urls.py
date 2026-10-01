from rest_framework.routers import DefaultRouter

from apps.employees import views

app_name = "employees"

router = DefaultRouter()
router.register("employees", views.EmployeeViewSet, basename="employee")
router.register("departments", views.DepartmentViewSet, basename="department")
router.register("designations", views.DesignationViewSet, basename="designation")
router.register("skills", views.SkillViewSet, basename="skill")

urlpatterns = router.urls
