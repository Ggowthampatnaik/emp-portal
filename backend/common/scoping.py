"""Row-level visibility rules, shared by every module.

The rule is the same everywhere, so it lives in one place:

* HR / Admin / Super Admin  - the whole organization
* Manager                   - themselves plus their reporting branch
* Employee                  - only their own records

Views call :func:`visible_employee_ids` (or one of the wrappers) instead of
filtering ad hoc, so a missed check cannot silently widen access.
"""

from django.db.models import QuerySet

from common.enums import RoleSlug


def employee_profile(user):
    return getattr(user, "employee_profile", None)


def visible_employee_ids(user) -> set[int] | None:
    """Employee ids this user may see. ``None`` means "no restriction"."""
    if not user or not user.is_authenticated:
        return set()
    if user.is_privileged:
        return None

    profile = employee_profile(user)
    if profile is None:
        return set()

    allowed = {profile.pk}
    if RoleSlug.MANAGER in user.role_slugs:
        allowed |= profile.descendant_ids()
    return allowed


def scope_by_employee(queryset: QuerySet, user, field: str = "employee") -> QuerySet:
    """Restricts ``queryset`` to the rows whose ``field`` the user may see."""
    allowed = visible_employee_ids(user)
    if allowed is None:
        return queryset
    if not allowed:
        return queryset.none()
    return queryset.filter(**{f"{field}_id__in": allowed})


def scope_employees(queryset: QuerySet, user) -> QuerySet:
    """Same rule, for a queryset of Employee itself."""
    allowed = visible_employee_ids(user)
    if allowed is None:
        return queryset
    if not allowed:
        return queryset.none()
    return queryset.filter(pk__in=allowed)


def can_act_on_employee(user, employee_id: int) -> bool:
    allowed = visible_employee_ids(user)
    return allowed is None or employee_id in allowed


def approvable_employee_ids(user) -> set[int] | None:
    """Employees whose leave/timesheets this user may approve.

    Approvers act on their reports, not on themselves - self-approval is the
    one case the visibility rule must not permit.
    """
    if not user or not user.is_authenticated:
        return set()

    profile = employee_profile(user)
    if user.is_privileged:
        return None  # HR/Admin can act org-wide

    if RoleSlug.MANAGER in user.role_slugs and profile is not None:
        return profile.descendant_ids()
    return set()
