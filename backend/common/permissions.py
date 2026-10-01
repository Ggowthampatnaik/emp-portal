"""Role-based access control.

The architecture requires backend authorisation on *every* request, so views
declare their requirement explicitly rather than relying on the frontend hiding
a button. Two styles are supported:

* coarse role checks - ``permission_classes = [IsHR | IsManager]``
* fine-grained permission codes - ``required_permissions = ("leave.approve",)``
  combined with :class:`HasModulePermission`
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from common.enums import PRIVILEGED_ROLES, RoleSlug


def _roles(request) -> set[str]:
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return set()
    return set(user.role_slugs)


class RoleRequired(BasePermission):
    """Base class for role checks; subclasses set ``allowed_roles``."""

    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:
        roles = _roles(request)
        if not roles:
            return False
        if RoleSlug.SUPER_ADMIN in roles:
            return True
        return bool(roles.intersection(self.allowed_roles))


class IsSuperAdmin(RoleRequired):
    allowed_roles = (RoleSlug.SUPER_ADMIN,)


class IsAdmin(RoleRequired):
    allowed_roles = (RoleSlug.ADMIN,)


class IsHR(RoleRequired):
    allowed_roles = (RoleSlug.HR,)


class IsManager(RoleRequired):
    allowed_roles = (RoleSlug.MANAGER,)


class IsEmployee(RoleRequired):
    allowed_roles = tuple(RoleSlug.values)


class IsPrivileged(RoleRequired):
    """HR / Admin / Super Admin - org-wide visibility."""

    allowed_roles = tuple(PRIVILEGED_ROLES)


class ReadOnly(BasePermission):
    def has_permission(self, request, view) -> bool:
        return request.method in SAFE_METHODS


class HasModulePermission(BasePermission):
    """Checks the fine-grained permission codes declared on the view.

    ``required_permissions`` may be a flat tuple, or a dict keyed by HTTP method
    so a single view can require different codes for read and write.
    """

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False

        required = getattr(view, "required_permissions", ())
        if isinstance(required, dict):
            required = required.get(request.method, ())
        if not required:
            return True

        return all(user.has_module_permission(code) for code in required)


class IsOwnerOrPrivileged(BasePermission):
    """An employee may see their own record; HR / Admin see everyone.

    A manager sees the records of their direct reports. Objects opt in by
    exposing either ``user`` or ``employee`` (or being the employee themselves).
    """

    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not user.is_authenticated:
            return False
        if user.is_privileged:
            return True

        owner = self._owner_user_id(obj)
        if owner is not None and owner == user.pk:
            return True

        if RoleSlug.MANAGER in user.role_slugs:
            return self._is_direct_report(user, obj)
        return False

    @staticmethod
    def _owner_user_id(obj):
        for attr in ("user_id", "employee__user_id"):
            if hasattr(obj, attr):
                return getattr(obj, attr)
        employee = getattr(obj, "employee", None)
        if employee is not None:
            return getattr(employee, "user_id", None)
        return getattr(obj, "pk", None) if hasattr(obj, "reporting_manager_id") else None

    @staticmethod
    def _is_direct_report(user, obj) -> bool:
        employee = getattr(obj, "employee", None) or obj
        manager_id = getattr(employee, "reporting_manager_id", None)
        employee_profile = getattr(user, "employee_profile", None)
        return (
            manager_id is not None
            and employee_profile is not None
            and (manager_id == employee_profile.pk)
        )
