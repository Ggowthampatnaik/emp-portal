"""Leave workflow.

The rules live here rather than in the views, so the API, the admin and any
future importer all behave identically. Leave is **two-stage**:

    apply           -> validate, reserve balance as *pending*, notify manager + CC
    manager_approve -> hand to HR. Balance untouched: still pending
    manager_reject  -> release the pending days. Only this stage may reject (D2)
    hr_approve      -> move pending days to used. **This is where the balance
                       is actually debited** (D1)
    hr_send_back    -> return it to the manager with a mandatory comment (D2),
                       days stay pending
    cancel          -> release pending (or used, if approved and in the future)

The single most important rule here is D1: days sit in ``pending_days`` for the
whole of stage one and only become ``used_days`` when HR approves. A manager
approving does not spend anyone's balance.

Balance changes and status changes always happen in the same transaction, and
the balance row is locked while it is being adjusted so two approvals of
overlapping requests cannot both pass the availability check.
"""

import logging
import re
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.employees.models import Employee
from apps.leave_management.models import (
    Holiday,
    LeaveApproval,
    LeaveBalance,
    LeaveRequest,
    LeaveRequestCC,
    LeaveType,
)
from apps.notifications.models import Notification
from apps.notifications.services import notify
from common.enums import LEAVE_PENDING_STATES, LeaveStageStatus, LeaveStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError
from common.humanize import days_phrase, human_range

logger = logging.getLogger("empportal.leave")

HALF = Decimal("0.5")


# ---------------------------------------------------------------------------
# Day counting
# ---------------------------------------------------------------------------
def holidays_between(start: date, end: date) -> set[date]:
    """Mandatory holidays only - optional ones still consume leave."""
    return set(
        Holiday.objects.filter(date__range=(start, end), is_optional=False).values_list(
            "date", flat=True
        )
    )


def count_leave_days(start: date, end: date, day_part: str = LeaveRequest.DayPart.FULL) -> Decimal:
    """Working days in the range, excluding weekends and company holidays."""
    if end < start:
        raise BusinessRuleViolation("The end date cannot precede the start date.")

    holidays = holidays_between(start, end)
    days = 0
    current = start
    while current <= end:
        if current.weekday() < 5 and current not in holidays:
            days += 1
        current = date.fromordinal(current.toordinal() + 1)

    if days == 0:
        return Decimal("0")
    if day_part != LeaveRequest.DayPart.FULL:
        if start != end:
            raise BusinessRuleViolation("A half day applies to a single date only.")
        return HALF
    return Decimal(days)


# ---------------------------------------------------------------------------
# Balances
# ---------------------------------------------------------------------------
def revoke_ineligible_balances(employee: Employee) -> int:
    """Closes balances for restricted types the employee no longer qualifies for.

    Eligibility is checked wherever a balance is *opened* or listed, but nothing
    reconsidered the ones already sitting in the table. Change somebody's gender
    on their profile and their maternity balance stayed behind - invisible on
    the page, because the list filters on gender too, and still there in the
    row count, in an export, and to anything that queries balances directly.

    A balance with days used or reserved against it is left alone. Those are a
    record of leave somebody actually took; entitlement can stop applying from
    here on, but it cannot retroactively un-happen. Cleaning those up is a
    conversation for HR, not something to do silently on a profile save.

    Returns how many were removed.
    """
    stale = (
        LeaveBalance.objects.filter(employee=employee)
        .exclude(leave_type__restricted_to_gender="")
        .exclude(leave_type__restricted_to_gender=employee.gender)
        .filter(used_days=0, pending_days=0)
    )
    removed = 0
    for balance in stale.select_related("leave_type"):
        logger.info(
            "Closing %s balance for %s: no longer eligible",
            balance.leave_type.code,
            employee.employee_code,
        )
        balance.delete()
        removed += 1
    return removed


def get_or_create_balance(employee: Employee, leave_type: LeaveType, year: int) -> LeaveBalance:
    balance, created = LeaveBalance.objects.get_or_create(
        employee=employee,
        leave_type=leave_type,
        year=year,
        defaults={"allocated_days": leave_type.days_per_year},
    )
    if created:
        logger.info(
            "Opened %s balance for %s (%s days)",
            leave_type.code,
            employee.employee_code,
            leave_type.days_per_year,
        )
    return balance


def _locked_balance(employee_id: int, leave_type_id: int, year: int) -> LeaveBalance:
    return LeaveBalance.objects.select_for_update().get(
        employee_id=employee_id, leave_type_id=leave_type_id, year=year
    )


def approver_for(employee: Employee):
    """The user who should act on stage one of this employee's requests."""
    manager = employee.reporting_manager
    return manager.user if manager else None


def hr_approvers():
    """Everyone who can clear stage two.

    HR is a role, not a person, so the stage-two notification goes to whoever
    currently holds both the approval and the company-wide view. Super Admins
    are included because they hold every permission implicitly.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return (
        User.objects.filter(
            is_active=True,
            user_roles__role__permissions__code__in=["leave.approve"],
        )
        .filter(user_roles__role__permissions__code="leave.view_all")
        .distinct()
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def assert_no_overlap(
    employee: Employee, start: date, end: date, exclude_pk: int | None = None
) -> None:
    clash = LeaveRequest.objects.filter(
        employee=employee,
        status__in=[*LEAVE_PENDING_STATES, LeaveStatus.APPROVED],
        start_date__lte=end,
        end_date__gte=start,
    )
    if exclude_pk:
        clash = clash.exclude(pk=exclude_pk)
    existing = clash.first()
    if existing:
        raise BusinessRuleViolation(
            "You already have "
            f"{existing.get_status_display().lower()} leave from {existing.start_date} "
            f"to {existing.end_date}."
        )


def validate_request(
    employee: Employee,
    leave_type: LeaveType,
    start: date,
    end: date,
    day_part: str,
    exclude_pk: int | None = None,
) -> Decimal:
    """Runs every rule and returns the day count the request would consume."""
    # Leave is asked for, not reported: a day already worked or already missed
    # cannot be applied for after the fact. Today is allowed - somebody who
    # wakes up ill applies that morning. `localdate` rather than `date.today`,
    # so the boundary is midnight where the company is rather than in UTC.
    if start < timezone.localdate():
        raise BusinessRuleViolation(
            "Leave cannot be applied for in the past. The earliest date is today."
        )
    if not leave_type.is_active:
        raise BusinessRuleViolation(f"{leave_type.name} is no longer available.")
    if not leave_type.available_to(employee):
        raise BusinessRuleViolation(f"{leave_type.name} is not available on your profile.")

    days = count_leave_days(start, end, day_part)
    if days <= 0:
        raise BusinessRuleViolation(
            "The selected dates contain no working days - they are weekends or company holidays."
        )

    if leave_type.max_consecutive_days and days > leave_type.max_consecutive_days:
        raise BusinessRuleViolation(
            f"{leave_type.name} allows at most {leave_type.max_consecutive_days} "
            "consecutive days per request."
        )
    if day_part != LeaveRequest.DayPart.FULL and not leave_type.allow_half_day:
        raise BusinessRuleViolation(f"{leave_type.name} cannot be taken as a half day.")

    assert_no_overlap(employee, start, end, exclude_pk=exclude_pk)

    balance = get_or_create_balance(employee, leave_type, start.year)
    if days > balance.available_days:
        raise BusinessRuleViolation(
            f"Insufficient {leave_type.name} balance: {balance.available_days} day(s) "
            f"available, {days} requested."
        )
    return days


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
@transaction.atomic
def apply_for_leave(
    employee: Employee,
    leave_type: LeaveType,
    start: date,
    end: date,
    reason: str,
    day_part: str = LeaveRequest.DayPart.FULL,
    contact_number: str = "",
    cc_user_ids: list[int] | None = None,
) -> LeaveRequest:
    """Creates the request, reserves the days as pending, and copies people in."""
    days = validate_request(employee, leave_type, start, end, day_part)

    request = LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=start,
        end_date=end,
        day_part=day_part,
        total_days=days,
        reason=reason,
        contact_number=contact_number,
        status=LeaveStatus.PENDING_MANAGER,
    )

    balance = _locked_balance(employee.pk, leave_type.pk, start.year)
    balance.pending_days += days
    balance.save(update_fields=["pending_days", "updated_at"])

    approver = approver_for(employee)
    notify(
        approver,
        title=f"Leave request from {employee.full_name}",
        message=(
            f"{employee.full_name} has applied for {days_phrase(days)} of {leave_type.name}, "
            f"{human_range(start, end)}.\n\nReason: {reason}"
        ),
        kind=Notification.Kind.LEAVE_APPLIED,
        level=Notification.Level.INFO,
        link="/leave/approvals",
    )
    if approver is None:
        logger.warning(
            "Leave request %s has no reporting manager to notify; HR must action it.", request.pk
        )

    add_cc_recipients(request, cc_user_ids or [])
    return request


def add_cc_recipients(request: LeaveRequest, user_ids: list[int]) -> list[LeaveRequestCC]:
    """Copies people in and tells them once.

    Being copied in is informational only - it grants no access to the request,
    which is why nothing here touches scoping. The applicant and the approving
    manager are skipped: the workflow already tells them.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()

    already_told = {request.employee.user_id}
    approver = approver_for(request.employee)
    if approver is not None:
        already_told.add(approver.pk)

    wanted = [uid for uid in dict.fromkeys(user_ids) if uid not in already_told]
    users = User.objects.filter(pk__in=wanted, is_active=True)

    added = []
    for user in users:
        entry, is_new = LeaveRequestCC.objects.get_or_create(leave_request=request, user=user)
        if not is_new and entry.notified_at is not None:
            continue  # already copied in and told; do not tell them twice

        notify(
            user,
            title=f"Copied on {request.employee.full_name}'s leave request",
            message=(
                f"{request.employee.full_name} has applied for "
                f"{days_phrase(request.total_days)} of {request.leave_type.name}, "
                f"{human_range(request.start_date, request.end_date)}."
                "\n\nYou are copied in for information; no action is needed from you."
            ),
            kind=Notification.Kind.LEAVE_APPLIED,
            level=Notification.Level.INFO,
            link="/leave",
        )
        entry.notified_at = timezone.now()
        entry.save(update_fields=["notified_at", "updated_at"])
        added.append(entry)
    return added


def _load_for_decision(request_id: int) -> LeaveRequest:
    return (
        LeaveRequest.objects.select_for_update()
        .select_related("employee__user", "employee__reporting_manager__user", "leave_type")
        .get(pk=request_id)
    )


def _record(request: LeaveRequest, actor, action: str, comment: str) -> None:
    """Appends to the decision history and updates the "last decision" fields."""
    LeaveApproval.objects.create(leave_request=request, actor=actor, action=action, comment=comment)
    request.decided_by = actor
    request.decided_at = timezone.now()
    request.decision_comment = comment


@transaction.atomic
def manager_approve(request_id: int, actor, comment: str = "") -> LeaveRequest:
    """Stage one. Hands the request to HR; **no balance moves here** (D1)."""
    leave_request = _load_for_decision(request_id)

    if leave_request.status != LeaveStatus.PENDING_MANAGER:
        raise WorkflowStateError(
            f"This request is already {leave_request.get_status_display().lower()}."
        )

    leave_request.manager_status = LeaveStageStatus.APPROVED
    leave_request.manager_decided_by = actor
    leave_request.manager_decided_at = timezone.now()
    leave_request.manager_comment = comment
    leave_request.status = LeaveStatus.PENDING_HR
    _record(leave_request, actor, LeaveApproval.Action.MANAGER_APPROVED, comment)
    leave_request.save(
        update_fields=[
            "manager_status",
            "manager_decided_by",
            "manager_decided_at",
            "manager_comment",
            "status",
            "decided_by",
            "decided_at",
            "decision_comment",
            "updated_at",
        ]
    )

    for hr_user in hr_approvers():
        notify(
            hr_user,
            title=f"Leave awaiting HR: {leave_request.employee.full_name}",
            message=(
                f"{leave_request.employee.full_name}'s {leave_request.leave_type.name}, "
                f"{human_range(leave_request.start_date, leave_request.end_date)} "
                f"({days_phrase(leave_request.total_days)}), has been approved by their "
                "manager and needs HR approval."
            ),
            kind=Notification.Kind.LEAVE_APPLIED,
            level=Notification.Level.INFO,
            link="/leave/approvals",
        )

    notify(
        leave_request.employee.user,
        title="Leave approved by your manager",
        message=(
            f"Your {leave_request.leave_type.name} for "
            f"{human_range(leave_request.start_date, leave_request.end_date)} has been "
            "approved by your manager and is now with HR."
            + (f"\n\nComment: {comment}" if comment else "")
        ),
        kind=Notification.Kind.LEAVE_APPROVED,
        level=Notification.Level.INFO,
        link="/leave",
    )
    return leave_request


@transaction.atomic
def manager_reject(request_id: int, actor, comment: str = "") -> LeaveRequest:
    """Stage one refusal. The only way a request is rejected outright (D2)."""
    leave_request = _load_for_decision(request_id)

    if leave_request.status != LeaveStatus.PENDING_MANAGER:
        raise WorkflowStateError(
            "Only a request waiting on the manager can be rejected. "
            f"This one is {leave_request.get_status_display().lower()}."
        )

    balance = _locked_balance(
        leave_request.employee_id, leave_request.leave_type_id, leave_request.year
    )
    balance.pending_days = max(Decimal("0"), balance.pending_days - leave_request.total_days)
    balance.save(update_fields=["pending_days", "updated_at"])

    leave_request.manager_status = LeaveStageStatus.REJECTED
    leave_request.manager_decided_by = actor
    leave_request.manager_decided_at = timezone.now()
    leave_request.manager_comment = comment
    leave_request.status = LeaveStatus.REJECTED
    _record(leave_request, actor, LeaveApproval.Action.REJECTED, comment)
    leave_request.save(
        update_fields=[
            "manager_status",
            "manager_decided_by",
            "manager_decided_at",
            "manager_comment",
            "status",
            "decided_by",
            "decided_at",
            "decision_comment",
            "updated_at",
        ]
    )

    notify(
        leave_request.employee.user,
        title="Leave rejected",
        message=(
            f"Your {leave_request.leave_type.name} for "
            f"{human_range(leave_request.start_date, leave_request.end_date)} was rejected "
            "by your manager." + (f"\n\nReason: {comment}" if comment else "")
        ),
        kind=Notification.Kind.LEAVE_REJECTED,
        level=Notification.Level.WARNING,
        link="/leave",
    )
    return leave_request


@transaction.atomic
def hr_approve(request_id: int, actor, comment: str = "") -> LeaveRequest:
    """Stage two. **This is where the balance is debited** (decision D1)."""
    leave_request = _load_for_decision(request_id)

    if leave_request.status != LeaveStatus.PENDING_HR:
        raise WorkflowStateError(
            "HR can only approve a request the manager has already approved. "
            f"This one is {leave_request.get_status_display().lower()}."
        )

    balance = _locked_balance(
        leave_request.employee_id, leave_request.leave_type_id, leave_request.year
    )
    days = leave_request.total_days
    balance.pending_days = max(Decimal("0"), balance.pending_days - days)
    balance.used_days += days
    balance.save(update_fields=["pending_days", "used_days", "updated_at"])

    leave_request.hr_status = LeaveStageStatus.APPROVED
    leave_request.hr_decided_by = actor
    leave_request.hr_decided_at = timezone.now()
    leave_request.hr_comment = comment
    leave_request.status = LeaveStatus.APPROVED
    _record(leave_request, actor, LeaveApproval.Action.HR_APPROVED, comment)
    leave_request.save(
        update_fields=[
            "hr_status",
            "hr_decided_by",
            "hr_decided_at",
            "hr_comment",
            "status",
            "decided_by",
            "decided_at",
            "decision_comment",
            "updated_at",
        ]
    )

    notify(
        leave_request.employee.user,
        title="Leave approved",
        message=(
            f"Your {leave_request.leave_type.name} for "
            f"{human_range(leave_request.start_date, leave_request.end_date)} "
            f"({days_phrase(days)}) has been approved by HR and is confirmed."
            + (f"\n\nComment: {comment}" if comment else "")
        ),
        kind=Notification.Kind.LEAVE_APPROVED,
        level=Notification.Level.SUCCESS,
        link="/leave",
    )
    return leave_request


@transaction.atomic
def hr_send_back(request_id: int, actor, comment: str) -> LeaveRequest:
    """Stage two disagreement (decision D2).

    HR has no Reject: a request it disagrees with goes back to the manager with
    a reason, so the conversation continues instead of dead-ending. The days
    stay reserved throughout - nothing about the employee's balance changes.
    """
    leave_request = _load_for_decision(request_id)

    if leave_request.status != LeaveStatus.PENDING_HR:
        raise WorkflowStateError(
            "Only a request waiting on HR can be sent back to the manager. "
            f"This one is {leave_request.get_status_display().lower()}."
        )
    if not comment.strip():
        raise BusinessRuleViolation(
            "Say why you are sending this back - the manager has to act on it."
        )

    leave_request.hr_status = LeaveStageStatus.SENT_BACK
    leave_request.hr_decided_by = actor
    leave_request.hr_decided_at = timezone.now()
    leave_request.hr_comment = comment
    # The manager stage starts again from scratch, so its earlier approval does
    # not leave the request looking already cleared.
    leave_request.manager_status = LeaveStageStatus.PENDING
    leave_request.status = LeaveStatus.PENDING_MANAGER
    _record(leave_request, actor, LeaveApproval.Action.SENT_BACK, comment)
    leave_request.save(
        update_fields=[
            "hr_status",
            "hr_decided_by",
            "hr_decided_at",
            "hr_comment",
            "manager_status",
            "status",
            "decided_by",
            "decided_at",
            "decision_comment",
            "updated_at",
        ]
    )

    approver = approver_for(leave_request.employee)
    notify(
        approver,
        title=f"HR sent back {leave_request.employee.full_name}'s leave request",
        message=(
            f"HR has returned the {leave_request.leave_type.name} request for "
            f"{human_range(leave_request.start_date, leave_request.end_date)} for another look."
            f"\n\nHR's comment: {comment}"
        ),
        kind=Notification.Kind.LEAVE_APPLIED,
        level=Notification.Level.WARNING,
        link="/leave/approvals",
    )
    notify(
        leave_request.employee.user,
        title="Leave request sent back to your manager",
        message=(
            f"HR has returned your {leave_request.leave_type.name} request for "
            f"{human_range(leave_request.start_date, leave_request.end_date)} to your manager."
            f"\n\nHR's comment: {comment}"
        ),
        kind=Notification.Kind.LEAVE_APPLIED,
        level=Notification.Level.WARNING,
        link="/leave",
    )
    return leave_request


@transaction.atomic
def cancel_leave(request_id: int, actor, comment: str = "") -> LeaveRequest:
    """Cancels a pending request, or an approved one that has not started."""
    leave_request = (
        LeaveRequest.objects.select_for_update()
        .select_related("employee__user", "leave_type")
        .get(pk=request_id)
    )

    if leave_request.status == LeaveStatus.CANCELLED:
        raise WorkflowStateError("This request is already cancelled.")
    if leave_request.status == LeaveStatus.REJECTED:
        raise WorkflowStateError("A rejected request cannot be cancelled.")
    if (
        leave_request.status == LeaveStatus.APPROVED
        and leave_request.start_date <= timezone.localdate()
    ):
        raise WorkflowStateError(
            "Approved leave that has already started cannot be cancelled here - contact HR."
        )

    balance = _locked_balance(
        leave_request.employee_id, leave_request.leave_type_id, leave_request.year
    )
    days = leave_request.total_days
    if leave_request.is_pending:
        # Either stage: the days were never debited, so releasing the
        # reservation is all that is needed.
        balance.pending_days = max(Decimal("0"), balance.pending_days - days)
        balance.save(update_fields=["pending_days", "updated_at"])
    else:  # approved, in the future - give the days back
        balance.used_days = max(Decimal("0"), balance.used_days - days)
        balance.save(update_fields=["used_days", "updated_at"])

    leave_request.status = LeaveStatus.CANCELLED
    leave_request.cancelled_at = timezone.now()
    leave_request.decision_comment = comment or leave_request.decision_comment
    leave_request.save(update_fields=["status", "cancelled_at", "decision_comment", "updated_at"])
    LeaveApproval.objects.create(
        leave_request=leave_request,
        actor=actor,
        action=LeaveApproval.Action.CANCELLED,
        comment=comment,
    )

    approver = approver_for(leave_request.employee)
    if approver and approver != actor:
        notify(
            approver,
            title=f"Leave cancelled by {leave_request.employee.full_name}",
            message=(
                f"The {leave_request.leave_type.name} request for "
                f"{human_range(leave_request.start_date, leave_request.end_date)} was cancelled."
            ),
            kind=Notification.Kind.LEAVE_CANCELLED,
            link="/leave/approvals",
        )
    return leave_request


# ---------------------------------------------------------------------------
# Holiday calendar import (.docx)
# ---------------------------------------------------------------------------

_MONTH_NUMBERS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

#: "1st" / "22nd" ordinal suffixes, stripped before date parsing.
_ORDINALS = re.compile(r"(\d{1,2})(st|nd|rd|th)\b", re.IGNORECASE)

#: The date shapes people actually put in a holiday circular.
_DATE_PATTERNS = (
    # 2026-01-14
    re.compile(r"\b(?P<y>\d{4})-(?P<m>\d{1,2})-(?P<d>\d{1,2})\b"),
    # 14/01/2026, 14-01-2026, 14.01.2026  (day first - an Indian circular)
    re.compile(r"\b(?P<d>\d{1,2})[/.-](?P<m>\d{1,2})[/.-](?P<y>\d{4})\b"),
    # 14 January 2026, 14 Jan (year optional)
    re.compile(r"\b(?P<d>\d{1,2})\s+(?P<mon>[A-Za-z]{3,9})\.?(?:\s+(?P<y>\d{4}))?\b"),
    # January 14, 2026 / Jan 14 (year optional)
    re.compile(r"\b(?P<mon>[A-Za-z]{3,9})\.?\s+(?P<d>\d{1,2})(?:\s*,\s*(?P<y>\d{4}))?\b"),
)


def _find_date(text: str, default_year: int) -> tuple[date, str] | None:
    """The first date in ``text``, plus the text with that date removed.

    A missing year means the circular says "14 January" and the year comes
    from the upload - HR imports one calendar year at a time.
    """
    cleaned = _ORDINALS.sub(r"\1", text)
    for pattern in _DATE_PATTERNS:
        match = pattern.search(cleaned)
        if not match:
            continue
        groups = match.groupdict()
        if "mon" in groups and groups.get("mon") is not None:
            month = _MONTH_NUMBERS.get(groups["mon"][:3].lower())
            if month is None:
                continue  # a word that merely looks like a month ("March" in "Marching")
        else:
            month = int(groups["m"])
        year = int(groups["y"]) if groups.get("y") else default_year
        try:
            found = date(year, month, int(groups["d"]))
        except ValueError:
            continue
        remainder = (cleaned[: match.start()] + " " + cleaned[match.end() :]).strip()
        return found, remainder
    return None


def _holiday_name(raw: str) -> str:
    """Strips list bullets, separators and the optional-marker from a name."""
    name = re.sub(r"\(?\b(optional|floating|restricted)\b\)?", "", raw, flags=re.IGNORECASE)
    name = name.strip(" \t-–—:;,.*•·")  # noqa: RUF001
    return re.sub(r"\s{2,}", " ", name)


def _rows_from_docx(document) -> list[list[str]]:
    """Every table row and every paragraph, as lists of cell texts.

    A paragraph is a one-cell row; the same extraction then serves both the
    tabular circular and the bulleted one.
    """
    rows: list[list[str]] = []
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                rows.append(cells)
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            rows.append([text])
    return rows


def parse_holidays_docx(file, default_year: int) -> tuple[list[dict], list[str]]:
    """Reads holiday rows out of a Word document.

    Understands both shapes HR actually sends: a table (date | name |
    optional? | description) and a plain list ("14 January - Makar
    Sankranti"). Returns the parsed holidays and the lines it had to skip,
    so the caller can show HR exactly what did not make it in.
    """
    from zipfile import BadZipFile

    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError

    try:
        document = Document(file)
    except (PackageNotFoundError, BadZipFile, KeyError, ValueError) as exc:
        raise BusinessRuleViolation(
            "That file could not be read as a Word document (.docx)."
        ) from exc

    parsed: dict[date, dict] = {}
    skipped: list[str] = []

    for cells in _rows_from_docx(document):
        joined = " | ".join(cells)
        hit = None
        for cell in cells:
            hit = _find_date(cell, default_year)
            if hit:
                date_cell_rest = hit[1]
                other_cells = [c for c in cells if c is not cell]
                break
        if hit is None:
            hit = _find_date(joined, default_year)
            if hit:
                date_cell_rest = hit[1]
                other_cells = []
        if hit is None:
            # Header rows and prose are expected, not errors; only report
            # lines that look like they were meant to carry a holiday.
            if re.search(r"\d", joined) and len(joined) > 3:
                skipped.append(joined[:120])
            continue

        found_date = hit[0]
        name_source = next((c for c in other_cells if _holiday_name(c)), "") or date_cell_rest
        name = _holiday_name(name_source)
        if not name:
            skipped.append(joined[:120])
            continue

        used = {name_source}
        description = " ".join(
            c for c in other_cells if c not in used and _holiday_name(c) and len(c) > 3
        ).strip()
        parsed[found_date] = {
            "date": found_date,
            "name": name[:150],
            "is_optional": bool(re.search(r"\b(optional|floating)\b", joined, re.IGNORECASE)),
            "description": description,
        }

    return list(parsed.values()), skipped


@transaction.atomic
def import_holidays_docx(file, default_year: int) -> tuple[dict, list[tuple["Holiday", bool]]]:
    """Creates or updates holidays from a Word document; nothing is deleted.

    The document is authoritative for the rows it names - a renamed holiday or
    a changed optional flag is applied - but silent about everything else, so
    an import can never wipe the calendar. Deleting is a decision someone
    takes on the page, one holiday at a time.
    """
    entries, skipped = parse_holidays_docx(file, default_year)
    if not entries and not skipped:
        raise BusinessRuleViolation(
            "No holidays were found in that document. Expected a table or a list "
            'with a date and a name per row, like "14 January - Makar Sankranti".'
        )

    created = updated = unchanged = 0
    touched: list[tuple[Holiday, bool]] = []
    for entry in entries:
        existing = Holiday.objects.filter(date=entry["date"]).first()
        if existing is None:
            holiday = Holiday.objects.create(
                date=entry["date"],
                name=entry["name"],
                is_optional=entry["is_optional"],
                description=entry["description"],
            )
            created += 1
            touched.append((holiday, True))
            continue

        fields: list[str] = []
        if existing.name != entry["name"]:
            existing.name = entry["name"]
            fields.append("name")
        if existing.is_optional != entry["is_optional"]:
            existing.is_optional = entry["is_optional"]
            fields.append("is_optional")
        # The description is only replaced when the document brings one:
        # a bare list must not blank out copy someone wrote on the page.
        if entry["description"] and existing.description != entry["description"]:
            existing.description = entry["description"]
            fields.append("description")

        if fields:
            existing.save(update_fields=[*fields, "updated_at"])
            updated += 1
            touched.append((existing, False))
        else:
            unchanged += 1

    summary = {
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped[:10],
        "skipped_count": len(skipped),
        "holidays": [
            {"date": e["date"].isoformat(), "name": e["name"], "is_optional": e["is_optional"]}
            for e in sorted(entries, key=lambda e: e["date"])
        ],
    }
    return summary, touched
