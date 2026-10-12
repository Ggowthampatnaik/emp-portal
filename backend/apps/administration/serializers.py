"""Administration serializers."""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.administration.models import AuditLog, SystemSetting
from common.enums import RoleSlug

User = get_user_model()


class UserAdminSerializer(serializers.ModelSerializer):
    """Account view for administrators. Roles are changed via ``/roles``."""

    full_name = serializers.CharField(read_only=True)
    roles = serializers.SerializerMethodField()
    employee_code = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "is_active",
            "must_change_password",
            "roles",
            "employee_code",
            "department",
            "last_login_at",
            "created_at",
        )
        read_only_fields = (
            "email",
            "full_name",
            "roles",
            "employee_code",
            "department",
            "last_login_at",
            "created_at",
        )

    def get_roles(self, obj) -> list[str]:
        return sorted(obj.role_slugs)

    def get_employee_code(self, obj) -> str | None:
        profile = getattr(obj, "employee_profile", None)
        return profile.employee_code if profile else None

    def get_department(self, obj) -> str | None:
        profile = getattr(obj, "employee_profile", None)
        return profile.department.name if profile and profile.department_id else None


class UserBulkDeleteSerializer(serializers.Serializer):
    """Which accounts to delete: an explicit list, or every account.

    `all` exists so "delete all users" does not depend on the client having
    paged through the whole table to collect ids. The caller's own account is
    never deleted either way - the server skips it and says so.
    """

    ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=False)
    all = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if not attrs.get("all") and not attrs.get("ids"):
            raise serializers.ValidationError("Pass ids, or all=true.")
        return attrs


class UserBulkDeleteResultSerializer(serializers.Serializer):
    deleted = serializers.IntegerField(help_text="Bare accounts removed outright.")
    deactivated = serializers.IntegerField(
        help_text="People switched off: inactive, cannot sign in, history kept."
    )
    skipped = serializers.ListField(child=serializers.CharField())


class RoleAssignmentSerializer(serializers.Serializer):
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=RoleSlug.choices), allow_empty=False
    )

    def validate_roles(self, value: list[str]) -> list[str]:
        return sorted(set(value))


class UserPasswordResetSerializer(serializers.Serializer):
    temporary_password = serializers.CharField(min_length=8, write_only=True)

    def validate_temporary_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class SystemSettingSerializer(serializers.ModelSerializer):
    typed_value = serializers.SerializerMethodField()  # str | int | Decimal | bool

    class Meta:
        model = SystemSetting
        fields = (
            "id",
            "key",
            "value",
            "value_type",
            "typed_value",
            "description",
            "is_editable",
            "updated_at",
        )
        read_only_fields = ("typed_value", "updated_at")

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_typed_value(self, obj: SystemSetting) -> str:
        try:
            return str(obj.typed_value)
        except (TypeError, ValueError):
            return obj.value

    def validate(self, attrs: dict) -> dict:
        if self.instance and not self.instance.is_editable and "value" in attrs:
            raise serializers.ValidationError({"value": ["This setting is not editable."]})
        return attrs


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = (
            "id",
            "actor",
            "actor_name",
            "actor_email",
            "action",
            "entity_type",
            "entity_id",
            "entity_label",
            "changes",
            "ip_address",
            "request_id",
            "created_at",
        )
        read_only_fields = fields
