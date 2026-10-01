from django.apps import AppConfig


class LeaveManagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.leave_management"
    label = "leave_management"
    verbose_name = "Leave Management"

    def ready(self) -> None:
        # Registers the handler that closes a restricted balance when the
        # profile it depended on changes.
        from apps.leave_management import signals  # noqa: F401
