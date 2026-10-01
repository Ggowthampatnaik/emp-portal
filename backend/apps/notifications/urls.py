from rest_framework.routers import DefaultRouter

from apps.notifications import views

app_name = "notifications"

router = DefaultRouter()
router.register("notifications", views.NotificationViewSet, basename="notification")

urlpatterns = router.urls
