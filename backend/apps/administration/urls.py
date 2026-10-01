from rest_framework.routers import DefaultRouter

from apps.administration import views

app_name = "administration"

router = DefaultRouter()
router.register("admin/users", views.UserAdminViewSet, basename="admin-user")
router.register("admin/roles", views.RoleViewSet, basename="admin-role")
router.register("admin/permissions", views.ModulePermissionViewSet, basename="admin-permission")
router.register("admin/settings", views.SystemSettingViewSet, basename="admin-setting")
router.register("admin/audit-logs", views.AuditLogViewSet, basename="admin-audit-log")
router.register(
    "admin/deletion-requests",
    views.AccountDeletionRequestViewSet,
    basename="admin-deletion-request",
)

urlpatterns = router.urls
