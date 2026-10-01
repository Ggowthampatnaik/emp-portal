"""Enumerations shared across apps.

Keeping the role slugs and workflow states in one place means the API, the
permission layer and the frontend TypeScript types all agree on the vocabulary.
"""

from django.db import models


class RoleSlug(models.TextChoices):
    """The role hierarchy from the architecture document.

    SUPER_ADMIN sits above HR / MANAGER / ADMIN, which are peers, and EMPLOYEE
    is the base role every user holds.
    """

    SUPER_ADMIN = "super_admin", "Super Admin"
    ADMIN = "admin", "Admin"
    HR = "hr", "HR"
    MANAGER = "manager", "Manager"
    # Finance releases pay; it is deliberately not a flavour of HR or Admin.
    FINANCE = "finance", "Finance"
    EMPLOYEE = "employee", "Employee"


# Module-level alias for the OpenAPI enum naming override in settings.
ROLE_SLUG_CHOICES = RoleSlug.choices

PRIVILEGED_ROLES = (
    RoleSlug.SUPER_ADMIN,
    RoleSlug.ADMIN,
    RoleSlug.HR,
)


class ApprovalStatus(models.TextChoices):
    """Shared vocabulary for the leave and timesheet approval workflows."""

    DRAFT = "draft", "Draft"
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class LeaveStatus(models.TextChoices):
    """Overall state of a leave request.

    Leave is two-stage (decision D1/D2) while timesheets stay single-stage, so
    this is its own vocabulary rather than an extension of ``ApprovalStatus``.
    ``approved``, ``rejected`` and ``cancelled`` keep the same wire values they
    had before the split, so anything filtering on those still works.
    """

    PENDING_MANAGER = "pending_manager", "Pending manager"
    PENDING_HR = "pending_hr", "Pending HR"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


#: Anything still awaiting a decision - reserves balance and blocks overlaps.
LEAVE_PENDING_STATES = (LeaveStatus.PENDING_MANAGER, LeaveStatus.PENDING_HR)


class LeaveStageStatus(models.TextChoices):
    """One stage's verdict. ``sent_back`` belongs to the HR stage only."""

    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    SENT_BACK = "sent_back", "Sent back to manager"


class EmploymentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    ON_NOTICE = "on_notice", "On Notice"
    INACTIVE = "inactive", "Inactive"


class AuditAction(models.TextChoices):
    CREATE = "create", "Create"
    UPDATE = "update", "Update"
    DELETE = "delete", "Delete"
    LOGIN = "login", "Login"
    LOGIN_FAILED = "login_failed", "Failed sign-in"
    LOCKED_OUT = "locked_out", "Account locked"
    LOGOUT = "logout", "Logout"
    APPROVE = "approve", "Approve"
    REJECT = "reject", "Reject"
    SUBMIT = "submit", "Submit"
    EXPORT = "export", "Export"
