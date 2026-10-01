"""Serializers for the authentication endpoints."""

import secrets

from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.authentication.models import ModulePermission, Role, User
from common.media import media_url


class ModulePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModulePermission
        fields = ("id", "code", "module", "name", "description")


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(slug_field="code", many=True, read_only=True)

    class Meta:
        model = Role
        fields = ("id", "slug", "name", "description", "is_system", "permissions")


class CurrentUserSerializer(serializers.ModelSerializer):
    """``GET /api/v1/auth/me`` - drives the frontend auth slice and route guards."""

    full_name = serializers.CharField(read_only=True)
    roles = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()
    employee_code = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    profile_completed = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "uuid",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "is_active",
            "roles",
            "permissions",
            "employee_id",
            "employee_code",
            "photo_url",
            "must_change_password",
            "profile_completed",
            "last_login_at",
        )
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[str]:
        return sorted(obj.role_slugs)

    def get_permissions(self, obj: User) -> list[str]:
        codes = ModulePermission.objects.filter(roles__users=obj).values_list("code", flat=True)
        return sorted(set(codes))

    def get_employee_id(self, obj: User) -> int | None:
        profile = getattr(obj, "employee_profile", None)
        return profile.pk if profile else None

    def get_employee_code(self, obj: User) -> str | None:
        profile = getattr(obj, "employee_profile", None)
        return profile.employee_code if profile else None

    def get_profile_completed(self, obj: User) -> bool:
        """True when the portal is open to them (F18).

        An account with no employment record - a bare administrator, say - has
        no profile to complete, so the gate does not apply.
        """
        profile = getattr(obj, "employee_profile", None)
        return True if profile is None else profile.profile_completed

    def get_photo_url(self, obj: User) -> str | None:
        profile = getattr(obj, "employee_profile", None)
        if profile is None or not profile.photo:
            return None
        request = self.context.get("request")
        return media_url(request, profile.photo)


#: Hashed once at import and never matched: it exists to be checked against
#: when there is no account, so a wrong password costs the same either way.
DUMMY_TOKEN_HASH = make_password(secrets.token_urlsafe(16))


class LoginSerializer(serializers.Serializer):
    """Email + password sign-in.

    Deliberately vague on failure: one message covers "no such account", "wrong
    password" and "deactivated", so the endpoint cannot be used to enumerate who
    works here.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    default_error_messages = {
        "invalid": "The email address or password is incorrect.",
        # Said plainly: the person holding it needs to know to ask for
        # another one, not to wonder whether they mistyped it.
        "expired_temporary": (
            "That temporary password has already been used or has expired. "
            "Request a new one from the sign-in page."
        ),
    }

    def validate(self, attrs: dict) -> dict:
        from apps.authentication.reset import reset_token_state

        email = attrs["email"].lower().strip()
        user = authenticate(
            request=self.context.get("request"), username=email, password=attrs["password"]
        )

        if user is None:
            # Not the account password. A live temporary password is the other
            # credential that opens the door - it lives in its own table until
            # it is used, so the account password keeps working meanwhile and
            # a stranger asking for a reset changes nothing for the owner.
            candidate = User.objects.filter(email__iexact=email, is_active=True).first()
            if candidate is not None:
                state = reset_token_state(candidate, attrs["password"])
            else:
                # The same work an account would have cost. Django's backend
                # runs a dummy hash for an unknown user precisely so sign-in
                # takes the same time either way, and the check above would
                # otherwise undo that.
                check_password(attrs["password"], DUMMY_TOKEN_HASH)
                state = "none"
            if state == "live":
                attrs["user"] = candidate
                attrs["temporary"] = True
                return attrs
            if state == "spent":
                raise serializers.ValidationError(
                    {"credentials": [self.error_messages["expired_temporary"]]},
                    code="expired_temporary_password",
                )
            raise serializers.ValidationError(
                {"credentials": [self.error_messages["invalid"]]}, code="invalid_credentials"
            )

        if not user.is_active:
            raise serializers.ValidationError(
                {"credentials": [self.error_messages["invalid"]]}, code="invalid_credentials"
            )

        # The account password matched - but once a temporary password has been
        # used it *becomes* the account password, and it only ever works once.
        # Django's authenticate() cannot tell the two apart; the token can.
        if reset_token_state(user, attrs["password"]) == "spent":
            raise serializers.ValidationError(
                {"credentials": [self.error_messages["expired_temporary"]]},
                code="expired_temporary_password",
            )

        attrs["user"] = user
        attrs["temporary"] = False
        return attrs


class LogoutSerializer(serializers.Serializer):
    """What sign-out sends: the refresh token to retire.

    Optional, because a client that has lost its refresh token must still be
    able to sign out - the endpoint records the event either way.
    """

    refresh = serializers.CharField(required=False, allow_blank=True)


class TokenPairSerializer(serializers.Serializer):
    """Response shape for both password sign-in and the Entra ID exchange."""

    access = serializers.CharField()
    refresh = serializers.CharField()
    user = CurrentUserSerializer()


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is incorrect.")
        return value

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value, self.context["request"].user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": ["The new password must differ from the current one."]}
            )
        return attrs

    def save(self, **kwargs) -> User:
        user: User = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.must_change_password = False
        # Every existing session dies, this one included. Whoever changed the
        # password proves it by signing in again; anyone else holding a token
        # issued against the old password loses it, which is the whole point of
        # changing a password you think somebody else may know.
        user.token_version += 1
        user.save(update_fields=["password", "must_change_password", "token_version", "updated_at"])
        return user


class EntraExchangeResponseSerializer(TokenPairSerializer):
    """Named separately so the SSO endpoint reads clearly in the schema."""


class PasswordForgotSerializer(serializers.Serializer):
    """Just an address. The response never varies on whether it exists."""

    email = serializers.EmailField()
