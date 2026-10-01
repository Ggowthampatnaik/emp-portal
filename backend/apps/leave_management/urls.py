from rest_framework.routers import DefaultRouter

from apps.leave_management import views

app_name = "leave_management"

router = DefaultRouter()
router.register("leaves", views.LeaveRequestViewSet, basename="leave-request")
router.register("leave-types", views.LeaveTypeViewSet, basename="leave-type")
router.register("leave-balances", views.LeaveBalanceViewSet, basename="leave-balance")
router.register("holidays", views.HolidayViewSet, basename="holiday")

urlpatterns = router.urls
