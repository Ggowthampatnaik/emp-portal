"""Employee lifecycle rules.

Today this is the account closure workflow: HR asks, an administrator decides.
The split exists so that no single person can remove someone's access to the
portal - the same maker-checker shape as payroll approval.

Approving **deactivates**; it never deletes. Leave, timesheets and payslips are
records the company still needs, and payroll records are a statutory
obligation, so the employee row and everything hanging off it stays exactly
where it is.
"""

import contextlib
import logging

from django.db import transaction
from django.utils import timezone

from apps.employees.models import AccountDeletionRequest, Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from common.enums import EmploymentStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError

logger = logging.getLogger("empportal.employees")


def deletion_approvers():
    """Everyone who may decide on a closure request.

    It is a role, not a person, so the notice goes to whoever currently holds
    the permission. Super Admins are matched by role rather than by permission
    because they hold every permission implicitly, without any of them being
    granted explicitly.
    """
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    from common.enums import RoleSlug

    return (
        get_user_model()
        .objects.filter(is_active=True)
        .filter(
            Q(user_roles__role__permissions__code="employee.approve_deletion")
            | Q(user_roles__role__slug=RoleSlug.SUPER_ADMIN)
        )
        .distinct()
    )


@transaction.atomic
def request_account_deletion(employee: Employee, actor, reason: str) -> AccountDeletionRequest:
    """HR asks for an account to be closed."""
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason - an administrator has to judge this.")

    if getattr(actor, "employee_profile", None) and actor.employee_profile.pk == employee.pk:
        raise BusinessRuleViolation("You cannot request the closure of your own account.")

    if employee.employment_status == EmploymentStatus.INACTIVE:
        raise BusinessRuleViolation(f"{employee.full_name}'s account is already inactive.")

    if AccountDeletionRequest.objects.filter(
        employee=employee, status=AccountDeletionRequest.Status.PENDING
    ).exists():
        raise BusinessRuleViolation(
            f"A closure request for {employee.full_name} is already waiting for a decision."
        )

    request = AccountDeletionRequest.objects.create(
        employee=employee, requested_by=actor, reason=reason
    )

    for approver in deletion_approvers():
        notify(
            approver,
            title=f"Account closure requested: {employee.full_name}",
            message=(
                f"{getattr(actor, 'full_name', 'HR')} has asked for "
                f"{employee.full_name}'s ({employee.employee_code}) account to be closed."
                f"\n\nReason: {reason}"
                "\n\nApproving deactivates the account. Nothing is deleted."
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.WARNING,
            link="/administration",
        )

    logger.info(
        "%s requested closure of %s",
        getattr(actor, "email", "system"),
        employee.employee_code,
    )
    return request


def _load_open(request_id: int) -> AccountDeletionRequest:
    request = (
        AccountDeletionRequest.objects.select_for_update()
        .select_related("employee__user", "requested_by")
        .get(pk=request_id)
    )
    if not request.is_open:
        raise WorkflowStateError(
            f"This request has already been {request.get_status_display().lower()}."
        )
    return request


def _assert_not_the_requester(request: AccountDeletionRequest, actor) -> None:
    """Maker-checker: whoever asked cannot also decide.

    The permission split usually settles this, but a Super Admin holds both -
    and that is exactly the account where one person closing another's access
    unchecked would matter most.
    """
    if request.requested_by_id and actor is not None and request.requested_by_id == actor.pk:
        raise BusinessRuleViolation("You raised this request, so someone else has to decide on it.")


@transaction.atomic
def approve_account_deletion(request_id: int, actor, note: str = "") -> AccountDeletionRequest:
    """Deactivates the account. Every record the employee touched stays."""
    request = _load_open(request_id)
    _assert_not_the_requester(request, actor)

    employee = request.employee
    employee.employment_status = EmploymentStatus.INACTIVE
    employee.save(update_fields=["employment_status", "updated_at"])
    employee.user.is_active = False
    employee.user.save(update_fields=["is_active", "updated_at"])

    request.status = AccountDeletionRequest.Status.APPROVED
    request.decided_by = actor
    request.decided_at = timezone.now()
    request.decision_note = note
    request.save(
        update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"]
    )

    if request.requested_by_id:
        notify(
            request.requested_by,
            title=f"Account closed: {employee.full_name}",
            message=(
                f"{employee.full_name}'s account has been deactivated. They can no longer "
                "sign in. Their leave, timesheets and payslips are untouched."
                + (f"\n\nNote: {note}" if note else "")
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.INFO,
            link="/employees",
        )

    logger.info(
        "%s approved closure of %s", getattr(actor, "email", "system"), employee.employee_code
    )
    return request


@transaction.atomic
def reject_account_deletion(request_id: int, actor, note: str) -> AccountDeletionRequest:
    """Refuses the request. The employee is left exactly as they were."""
    request = _load_open(request_id)
    _assert_not_the_requester(request, actor)

    if not note.strip():
        raise BusinessRuleViolation("Say why - HR asked for this and needs an answer.")

    request.status = AccountDeletionRequest.Status.REJECTED
    request.decided_by = actor
    request.decided_at = timezone.now()
    request.decision_note = note
    request.save(
        update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"]
    )

    if request.requested_by_id:
        notify(
            request.requested_by,
            title=f"Closure request declined: {request.employee.full_name}",
            message=(
                f"The request to close {request.employee.full_name}'s account was declined. "
                f"They remain active.\n\nReason: {note}"
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.WARNING,
            link="/employees",
        )
    return request


@transaction.atomic
def cancel_account_deletion(request_id: int, actor) -> AccountDeletionRequest:
    """HR withdraws its own request before anyone has acted on it."""
    request = _load_open(request_id)

    if request.requested_by_id and actor is not None and request.requested_by_id != actor.pk:
        raise BusinessRuleViolation("Only whoever raised this request can withdraw it.")

    request.status = AccountDeletionRequest.Status.CANCELLED
    request.decided_at = timezone.now()
    request.save(update_fields=["status", "decided_at", "updated_at"])
    return request


# ---------------------------------------------------------------------------
# Asset barcode reading
# ---------------------------------------------------------------------------


def decode_asset_barcode(uploaded_file) -> str | None:
    """Reads a barcode (or QR code) out of an uploaded asset photo.

    HR photographs the label on the back of the kit; whatever the barcode
    encodes becomes the asset's serial number, so nobody retypes what the
    sticker already says. Returns ``None`` whenever nothing usable decodes -
    a blurry photo, a picture of the front of the laptop, no barcode at all -
    and the caller falls back to asking for the number by hand. Never raises:
    a failed read must degrade to manual entry, not to a 500.
    """
    if uploaded_file is None:
        return None
    try:
        import zxingcpp
        from PIL import Image
    except ImportError:  # decoding library not installed in this environment
        logger.warning("zxing-cpp is not installed; asset barcode reading is off.")
        return None

    try:
        image = Image.open(uploaded_file)
        image.load()
        results = zxingcpp.read_barcodes(image)
    except Exception:  # any unreadable image means "no barcode", never a 500
        return None
    finally:
        # PIL consumed the stream; rewind it or Django saves a truncated file.
        with contextlib.suppress(OSError, ValueError):
            uploaded_file.seek(0)

    for result in results:
        text = (result.text or "").strip()
        if text:
            return text.upper()
    return None
