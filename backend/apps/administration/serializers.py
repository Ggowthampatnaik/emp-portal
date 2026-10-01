"""Administration serializers."""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.administration.models import AuditLog, SystemSetting
from common.enums import RoleSlug

User = get_user_model()


def next_employee_code() -> str:
    """The next free TRG code, by numeric suffix.

    A scan rather than a counter: codes have been seeded, imported and typed
    in by hand, and the only invariant that has survived all three is "unique,
    and mostly increasing".
    """
    from apps.employees.models import Employee

    highest = 0
    for code in Employee.objects.filter(employee_code__startswith="TRG").values_list(
        "employee_code", flat=True
    ):
        suffix = code[3:]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"TRG{highest + 1:04d}"


class UserCreateSerializer(serializers.Serializer):
    """A new joiner's account, created by an administrator.

    This is the front door of onboarding: the administrator hands out the email
    and temporary password, and everything else follows from the first sign-in
    - change the password, then complete the profile, and only then does the
    portal open.

    That second step is why an employment record is created alongside the
    account, with ``profile_completed`` unset. The profile gate deliberately
    ignores accounts with no employee record (a bare service account is not
    held up by it), so an account created *without* one would skip the
    complete-profile step entirely - which is exactly the bug this replaced.

    What it produces is an ordinary portal account, which matters: the password
    is hashed by ``create_user``, so the normal sign-in check finds it, and
    ``must_change_password`` is set, so the first sign-in lands on the
    change-password screen exactly as any joiner does. No second and weaker
    way in.

    Everyone joins as an employee - that is what being onboarded means, and an
    account with no role at all sees a sidebar of nothing. Anything more than
    employee is granted afterwards through the one role control on the table,
    so the two ways of assigning roles cannot drift apart.
    """

    email = serializers.EmailField()
    temporary_password = serializers.CharField(write_only=True, trim_whitespace=False)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=100)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_temporary_password(self, value: str) -> str:
        """Held to the same rules as any other password.

        A temporary password is a real credential for as long as it lasts, and
        the account it opens is a real account.
        """
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data: dict) -> User:
        from django.db import transaction

        from apps.employees.models import Employee

        with transaction.atomic():
            user = User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["temporary_password"],
                first_name=validated_data.get("first_name", "").strip(),
                last_name=validated_data.get("last_name", "").strip(),
            )
            user.must_change_password = True
            user.save(update_fields=["must_change_password"])
            Employee.objects.create(
                user=user,
                employee_code=next_employee_code(),
                date_of_joining=timezone.localdate(),
                profile_completed=False,
            )
            from apps.authentication.models import Role, UserRole

            employee_role = Role.objects.filter(slug=RoleSlug.EMPLOYEE).first()
            if employee_role:
                UserRole.objects.create(user=user, role=employee_role)
        return user


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
    deleted = serializers.IntegerField()
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
