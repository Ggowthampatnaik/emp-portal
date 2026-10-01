from rest_framework.routers import DefaultRouter

from apps.timesheets import views

app_name = "timesheets"

router = DefaultRouter()
router.register("timesheets", views.TimesheetViewSet, basename="timesheet")

urlpatterns = router.urls
