"""Administration API: users, roles, permissions, settings, audit log."""

from django.contrib.auth import get_user_model
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.administration.models import AuditLog, SystemSetting
from apps.administration.serializers import (
    AuditLogSerializer,
    RoleAssignmentSerializer,
    SystemSettingSerializer,
    UserAdminSerializer,
    UserBulkDeleteResultSerializer,
    UserBulkDeleteSerializer,
    UserCreateSerializer,
    UserPasswordResetSerializer,
)
from apps.authentication.models import ModulePermission, Role
from apps.authentication.serializers import ModulePermissionSerializer, RoleSerializer
from apps.employees.models import AccountDeletionRequest
from apps.employees.serializers import (
    AccountDeletionDecisionSerializer,
    AccountDeletionRequestSerializer,
)
from apps.employees.services import approve_account_deletion, reject_account_deletion
from common.audit import record_audit
from common.enums import AuditAction, RoleSlug
from common.permissions import HasModulePermission


class UserAdminViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Portal accounts.

    Two ways in: employee onboarding raises an account alongside an employment
    record, and an administrator can raise a bare account here for somebody who
    needs to sign in without being on the payroll. Both produce the same thing -
    a hashed password and ``must_change_password`` - so the first sign-in
    behaves identically whichever door it came through.
    """

    serializer_class = UserAdminSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("admin.manage_users",)
    # The same filter row as the Employees page, mapped through the
    # employment record: an account's status, department and skills are its
    # employee's. `filterset_fields` cannot express the skills AND-chain, so
    # the queryset applies these itself.
    FILTERABLE = {
        "employment_status": "employee_profile__employment_status",
        "department": "employee_profile__department",
    }
    # The same reach as the Employees page search: the table shows the
    # employee code, so typing one into the box above it has to find the row.
    search_fields = (
        "email",
        "first_name",
        "last_name",
        "employee_profile__employee_code",
    )
    ordering_fields = ("email", "last_login_at", "created_at")
    ordering = ("email",)

    def get_queryset(self):
        queryset = (
            get_user_model()
            .objects.prefetch_related("roles", "user_roles__role")
            .select_related("employee_profile")
        )
        if self.action == "list":
            for param, field in self.FILTERABLE.items():
                value = (self.request.query_params.get(param) or "").strip()
                if value:
                    queryset = queryset.filter(**{field: value})
            queryset = self._filter_by_skills(queryset)
        return queryset

    def _filter_by_skills(self, queryset):
        """`?skills=1,2` keeps accounts whose employee has **every** listed skill.

        The same AND-across-the-join rule as the Employees page, so the two
        search bars cannot disagree about what a skills filter means.
        """
        raw = (self.request.query_params.get("skills") or "").strip()
        if not raw:
            return queryset

        for part in dict.fromkeys(p.strip() for p in raw.split(",")):
            if not part.isdigit():
                from rest_framework.exceptions import ValidationError

                raise ValidationError({"skills": ["Give skill ids as a comma-separated list."]})
            queryset = queryset.filter(employee_profile__skills__skill_id=int(part))
        return queryset.distinct()

    def get_serializer_class(self):
        return UserCreateSerializer if self.action == "create" else UserAdminSerializer

    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        record_audit(request, AuditAction.CREATE, user, changes={"created_by": "administrator"})
        # Answered in the read shape, so the list the SPA already renders can
        # take the new row without a second request.
        return Response(
            UserAdminSerializer(user, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_update(self, serializer):
        before = {"is_active": serializer.instance.is_active}
        instance = serializer.save()
        record_audit(
            self.request,
            AuditAction.UPDATE,
            instance,
            changes={"is_active": [before["is_active"], instance.is_active]},
        )

    @extend_schema(request=RoleAssignmentSerializer, responses={200: UserAdminSerializer})
    @action(detail=True, methods=["post"], url_path="roles")
    def set_roles(self, request: Request, pk: str | None = None) -> Response:
        """Replaces a user's roles. Requires ``admin.manage_roles``."""
        if not request.user.has_module_permission("admin.manage_roles"):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("This action requires the 'admin.manage_roles' permission.")

        user = self.get_object()
        # The same rule as deleting accounts: not on your own. It happened -
        # a Super Admin unticked their own role in the table and demoted
        # themselves mid-session. Somebody else has to hold the pen.
        if user.pk == request.user.pk:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("You cannot change your own roles. Ask another administrator.")
        serializer = RoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        wanted = list(Role.objects.filter(slug__in=serializer.validated_data["roles"]))
        before = sorted(user.role_slugs)

        # Only a Super Admin may grant or revoke Super Admin. Without this an
        # Admin could promote anyone (or themselves via a colleague) past every
        # permission check the portal has.
        super_slug = RoleSlug.SUPER_ADMIN.value
        touches_super = (super_slug in serializer.validated_data["roles"]) != (super_slug in before)
        if touches_super and not request.user.is_super_admin:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Only a Super Admin can grant or revoke the Super Admin role.")

        with transaction.atomic():
            user.user_roles.exclude(role__in=wanted).delete()
            for role in wanted:
                user.user_roles.get_or_create(role=role, defaults={"assigned_by": request.user})

        user._role_slugs_cache = None
        user._permission_cache = None
        record_audit(
            request,
            AuditAction.UPDATE,
            user,
            changes={"roles": [before, sorted(role.slug for role in wanted)]},
        )
        return Response(UserAdminSerializer(user).data)

    @extend_schema(request=UserPasswordResetSerializer, responses={204: None})
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request: Request, pk: str | None = None) -> Response:
        """Issues a temporary password; the user must change it at next sign-in."""
        user = self.get_object()
        serializer = UserPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user.set_password(serializer.validated_data["temporary_password"])
        user.must_change_password = True
        # Somebody else has just replaced this person's credential, so whoever
        # is holding their existing sessions - possibly the reason for the reset
        # - is signed out. Same rule as the forgotten-password flow.
        user.token_version += 1
        user.save(update_fields=["password", "must_change_password", "token_version", "updated_at"])
        record_audit(request, AuditAction.UPDATE, user, changes={"password": "reset by admin"})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=UserBulkDeleteSerializer, responses={200: UserBulkDeleteResultSerializer}
    )
    @action(detail=False, methods=["post"], url_path="delete")
    def bulk_delete(self, request: Request) -> Response:
        """Deletes accounts - one, several, or all of them.

        A POST, not DELETE, because it takes a body and acts on many rows.
        Deleting a user cascades to their employment record and everything
        hanging off it; this is removal, not deactivation - the switch on
        each row is deactivation.

        Accounts are skipped rather than failing the whole request: the
        caller's own (locking every administrator out in one click should take
        more than one click), anyone holding an employment record (removing a
        person is the account-closure flow, which takes two people), and
        unknown ids, so a stale table does not turn into an error.

        ``all=true`` is Super Admin's alone.
        """
        serializer = UserBulkDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # "Every account" is not an ordinary administrative act, and holding
        # admin.manage_users is not consent to it.
        if serializer.validated_data.get("all") and not request.user.is_super_admin:
            raise PermissionDenied(
                "Deleting every account is a Super Admin action. Name the "
                "accounts to delete, or raise an account closure."
            )

        queryset = get_user_model().objects.all()
        if not serializer.validated_data.get("all"):
            queryset = queryset.filter(pk__in=serializer.validated_data["ids"])
            missing = set(serializer.validated_data["ids"]) - {user.pk for user in queryset}
        else:
            missing = set()

        skipped = [f"{pk}: no such account" for pk in sorted(missing)]
        deleted = 0
        for user in list(queryset):
            if user.pk == request.user.pk:
                skipped.append(f"{user.pk}: your own account")
                continue
            # Removing a *person* is the account-closure flow: HR raises it,
            # Admin approves it, two people. This endpoint clears accounts
            # that never became employees, and must not be the way around a
            # control the same role is meant to be the second half of.
            if getattr(user, "employee_profile", None) is not None:
                skipped.append(f"{user.pk}: has an employment record - use Account closures")
                continue
            record_audit(request, AuditAction.DELETE, user, changes={"email": user.email})
            user.delete()
            deleted += 1

        return Response({"deleted": deleted, "skipped": skipped})


class RoleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The role catalogue and what each role grants."""

    queryset = Role.objects.prefetch_related("permissions").all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("admin.manage_roles",)


class ModulePermissionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Every permission code the portal understands."""

    queryset = ModulePermission.objects.all()
    serializer_class = ModulePermissionSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("admin.manage_roles",)
    filterset_fields = ("module",)
    ordering = ("module", "code")


class SystemSettingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Runtime configuration."""

    queryset = SystemSetting.objects.all()
    serializer_class = SystemSettingSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("admin.system_config",)
    search_fields = ("key", "description")
    ordering = ("key",)

    def perform_update(self, serializer):
        before = serializer.instance.value
        instance = serializer.save()
        record_audit(
            self.request, AuditAction.UPDATE, instance, changes={"value": [before, instance.value]}
        )

    def perform_create(self, serializer):
        record_audit(self.request, AuditAction.CREATE, serializer.save())


class AuditLogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The audit trail. Read-only by design - rows are never edited."""

    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("admin.view_audit_log",)
    filterset_fields = ("action", "entity_type", "actor")
    search_fields = ("actor_email", "entity_label", "request_id")
    ordering = ("-created_at",)

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("actor")
        params = self.request.query_params
        if params.get("from"):
            queryset = queryset.filter(created_at__date__gte=params["from"])
        if params.get("to"):
            queryset = queryset.filter(created_at__date__lte=params["to"])
        return queryset


class AccountDeletionRequestViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Account closure requests raised by HR, decided here.

    Approving deactivates the account and nothing more: no row is removed, so
    the person's leave, timesheets and payslips survive them leaving. Whoever
    raised the request cannot decide on it - see
    :mod:`apps.employees.services`.
    """

    serializer_class = AccountDeletionRequestSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = ("employee.approve_deletion",)
    filterset_fields = ("status", "employee")
    ordering = ("-requested_at",)

    def get_queryset(self):
        return AccountDeletionRequest.objects.select_related(
            "employee__user",
            "employee__department",
            "employee__designation",
            "requested_by",
            "decided_by",
        )

    def _decide(self, request: Request, transition, audit_action: str) -> Response:
        instance = self.get_object()
        serializer = AccountDeletionDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        updated = transition(instance.pk, request.user, serializer.validated_data["note"])
        record_audit(
            request,
            audit_action,
            updated,
            changes={
                "employee": updated.employee.employee_code,
                "status": [instance.status, updated.status],
                "note": updated.decision_note,
            },
        )
        return Response(AccountDeletionRequestSerializer(updated).data)

    @extend_schema(
        request=AccountDeletionDecisionSerializer,
        responses={200: AccountDeletionRequestSerializer},
        description="Approve: deactivate the account. Records are kept.",
    )
    @action(detail=True, methods=["post"])
    def approve(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, approve_account_deletion, AuditAction.APPROVE)

    @extend_schema(
        request=AccountDeletionDecisionSerializer,
        responses={200: AccountDeletionRequestSerializer},
        description="Decline the request. The employee stays active; a reason is required.",
    )
    @action(detail=True, methods=["post"])
    def reject(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, reject_account_deletion, AuditAction.REJECT)
