from django.apps import AppConfig


class AuthenticationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.authentication"
    label = "authentication"
    verbose_name = "Authentication & Authorization"

    def ready(self) -> None:
        # Registers the drf-spectacular security scheme for Entra ID tokens.
        from apps.authentication import schema  # noqa: F401
