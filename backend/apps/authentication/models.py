"""Identity, roles and permissions.

Users are provisioned from Microsoft Entra ID - the portal never stores a
company password. ``Role`` and ``ModulePermission`` implement the RBAC layer
described in the architecture document; ``password`` remains available only for
break-glass local superusers created via ``createsuperuser``.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from common.enums import PRIVILEGED_ROLES, RoleSlug
from common.models import TimeStampedModel, UUIDModel


class ModulePermission(TimeStampedModel):
    """A fine-grained capability, e.g. ``leave.approve`` or ``employee.create``."""

    MODULES = [
        ("authentication", "Authentication"),
        ("employees", "Employee Management"),
        ("projects", "Project Management"),
        ("leave", "Leave Management"),
        ("timesheets", "Timesheet Management"),
        ("payroll", "Payroll"),
        ("reports", "Reports & Analytics"),
        ("administration", "Administration"),
    ]

    code = models.CharField(max_length=100, unique=True)
    module = models.CharField(max_length=50, choices=MODULES)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "permissions"
        ordering = ("module", "code")
        verbose_name = "permission"

    def __str__(self) -> str:
        return self.code


class Role(TimeStampedModel):
    """A named bundle of permissions, matching the portal role hierarchy."""

    slug = models.CharField(max_length=50, unique=True, choices=RoleSlug.choices)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(
        default=True,
        help_text="System roles ship with the product and cannot be deleted.",
    )
    permissions = models.ManyToManyField(ModulePermission, related_name="roles", blank=True)

    class Meta:
        db_table = "roles"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class UserManager(BaseUserManager):
    """Email is the natural key; Entra ID supplies it."""

    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Users must have an email address.")
        user = self.model(email=self.normalize_email(email), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_active", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superuser must have is_staff and is_superuser set.")
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin, UUIDModel, TimeStampedModel):
    """Portal account, linked 1:1 to an Entra ID principal."""

    email = models.EmailField(_("email address"), unique=True, db_index=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)

    entra_object_id = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text="Entra ID object id (oid claim).",
    )
    entra_upn = models.CharField(max_length=255, blank=True)

    is_active = models.BooleanField(default=True)
    must_change_password = models.BooleanField(
        default=False,
        help_text="Set when HR/Admin issues a temporary password; forces a reset on next sign-in.",
    )
    is_staff = models.BooleanField(
        default=False, help_text="Access to the Django maintenance admin."
    )
    token_version = models.PositiveIntegerField(
        default=0,
        help_text=(
            "Bumped when the credential is replaced by someone other than the "
            "signed-in user. Portal tokens carry it, so every session issued "
            "before the bump stops working."
        ),
    )
    last_login_at = models.DateTimeField(null=True, blank=True)

    # Brute-force lockout. Counted against the account rather than the caller's
    # address, because throttling by address does nothing about the same guess
    # arriving from a thousand of them. See `apps/authentication/lockout.py`.
    failed_login_count = models.PositiveIntegerField(
        default=0,
        help_text="Consecutive failed sign-ins inside the lockout window. Reset on success.",
    )
    last_failed_login_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Sign-in is refused until this moment. Cleared by a successful sign-in.",
    )

    roles = models.ManyToManyField(
        Role,
        through="UserRole",
        through_fields=("user", "role"),
        related_name="users",
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "users"
        ordering = ("email",)

    def __str__(self) -> str:
        return self.email

    # -- naming ------------------------------------------------------------
    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def get_full_name(self) -> str:
        return self.full_name

    def get_short_name(self) -> str:
        return self.first_name or self.email

    # -- RBAC --------------------------------------------------------------
    @property
    def role_slugs(self) -> frozenset[str]:
        """Cached per instance - the permission layer hits this on every request."""
        cached = getattr(self, "_role_slugs_cache", None)
        if cached is None:
            cached = frozenset(self.roles.values_list("slug", flat=True))
            self._role_slugs_cache = cached
        return cached

    @property
    def is_privileged(self) -> bool:
        """HR / Admin / Super Admin - org-wide visibility."""
        return bool(self.role_slugs.intersection({r.value for r in PRIVILEGED_ROLES}))

    @property
    def is_super_admin(self) -> bool:
        return RoleSlug.SUPER_ADMIN in self.role_slugs

    def has_module_permission(self, code: str) -> bool:
        """True when any of the user's roles grants the permission ``code``."""
        if self.is_super_admin:
            return True
        cached = getattr(self, "_permission_cache", None)
        if cached is None:
            cached = frozenset(
                ModulePermission.objects.filter(roles__users=self).values_list("code", flat=True)
            )
            self._permission_cache = cached
        return code in cached

    def touch_login(self) -> None:
        self.last_login_at = timezone.now()
        self.save(update_fields=["last_login_at", "updated_at"])


class UserRole(TimeStampedModel):
    """Role assignment, recorded so the audit trail shows who granted what."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")
    assigned_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "user_roles"
        constraints = [models.UniqueConstraint(fields=("user", "role"), name="uniq_user_role")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.role_id}"


class PasswordResetToken(TimeStampedModel):
    """A temporary password that was issued to get someone back in (F17).

    Only the **hash** is kept, so the credential cannot be read back out of the
    database by anyone - support, an administrator, or whoever ends up with a
    backup. The row exists to enforce the two rules the plain account password
    cannot express on its own: it expires, and it works once.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_tokens")
    token_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    requested_ip = models.GenericIPAddressField(
        null=True, blank=True, help_text="Where the request came from, for abuse investigation."
    )

    class Meta:
        db_table = "password_reset_tokens"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("user", "-created_at"))]

    def __str__(self) -> str:
        return f"reset for {self.user_id} ({'used' if self.used_at else 'open'})"

    @property
    def is_live(self) -> bool:
        from django.utils import timezone as tz

        return self.used_at is None and self.expires_at > tz.now()
