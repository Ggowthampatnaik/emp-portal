"""Leave Management models.

Tables: leave_types, leave_balances, leave_requests, leave_request_cc,
leave_approvals, holidays
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.employees.models import Employee
from common.enums import LEAVE_PENDING_STATES, LeaveStageStatus, LeaveStatus
from common.models import TimeStampedModel


class LeaveType(TimeStampedModel):
    """A leave policy: how many days a year, and how it behaves."""

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    days_per_year = models.DecimalField(
        max_digits=5, decimal_places=1, validators=[MinValueValidator(Decimal("0"))]
    )
    is_paid = models.BooleanField(default=True)
    requires_approval = models.BooleanField(default=True)
    max_consecutive_days = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Blank means no limit."
    )
    allow_half_day = models.BooleanField(default=True)
    carry_forward = models.BooleanField(
        default=False, help_text="Unused days roll into next year's allocation."
    )
    restricted_to_gender = models.CharField(
        max_length=15,
        blank=True,
        choices=Employee.Gender.choices,
        help_text=(
            "Blank means everyone. A restricted type (maternity leave) simply "
            "does not exist for anyone else: no balance, no option to apply, "
            "no line in any total."
        ),
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "leave_types"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name

    def available_to(self, employee: "Employee") -> bool:
        """Whether this policy applies to this person at all.

        An unset gender does not qualify for a restricted type - entitlement
        follows from what the profile says, not from what it leaves blank.
        """
        return not self.restricted_to_gender or employee.gender == self.restricted_to_gender


class Holiday(TimeStampedModel):
    """A company holiday. Holidays never consume leave balance."""

    date = models.DateField(unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(
        blank=True, help_text="Shown to employees wherever the holiday appears."
    )
    is_optional = models.BooleanField(
        default=False, help_text="Optional/floating holidays still count as working days."
    )

    class Meta:
        db_table = "holidays"
        ordering = ("date",)

    def __str__(self) -> str:
        return f"{self.date} {self.name}"

    @property
    def year(self) -> int:
        return self.date.year


class LeaveBalance(TimeStampedModel):
    """One employee's entitlement for one leave type in one year."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_balances")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name="balances")
    year = models.PositiveSmallIntegerField()
    allocated_days = models.DecimalField(max_digits=6, decimal_places=1, default=Decimal("0"))
    used_days = models.DecimalField(max_digits=6, decimal_places=1, default=Decimal("0"))
    pending_days = models.DecimalField(
        max_digits=6,
        decimal_places=1,
        default=Decimal("0"),
        help_text="Reserved by requests awaiting a decision.",
    )
    carried_forward_days = models.DecimalField(max_digits=6, decimal_places=1, default=Decimal("0"))

    class Meta:
        db_table = "leave_balances"
        ordering = ("-year", "leave_type__name")
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "leave_type", "year"), name="uniq_balance_per_year"
            )
        ]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.leave_type.code} {self.year}"

    @property
    def entitled_days(self) -> Decimal:
        return self.allocated_days + self.carried_forward_days

    @property
    def available_days(self) -> Decimal:
        """What can still be applied for: entitlement minus used minus pending."""
        return self.entitled_days - self.used_days - self.pending_days


class LeaveRequest(TimeStampedModel):
    """An application for leave, and the workflow state it is in."""

    class DayPart(models.TextChoices):
        FULL = "full", "Full day"
        FIRST_HALF = "first_half", "First half"
        SECOND_HALF = "second_half", "Second half"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    day_part = models.CharField(max_length=12, choices=DayPart.choices, default=DayPart.FULL)
    total_days = models.DecimalField(max_digits=5, decimal_places=1)
    reason = models.TextField()
    contact_number = models.CharField(max_length=20, blank=True)

    # Overall state. The two stages below carry who decided what and when;
    # this is the single field every queue and report filters on.
    status = models.CharField(
        max_length=20,
        choices=LeaveStatus.choices,
        default=LeaveStatus.PENDING_MANAGER,
        db_index=True,
    )
    applied_at = models.DateTimeField(auto_now_add=True)

    # Stage 1 - the reporting manager. Rejection is only possible here (D2).
    manager_status = models.CharField(
        max_length=12, choices=LeaveStageStatus.choices, default=LeaveStageStatus.PENDING
    )
    manager_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_manager_decisions",
    )
    manager_decided_at = models.DateTimeField(null=True, blank=True)
    manager_comment = models.TextField(blank=True)

    # Stage 2 - HR. Approve, or send back to the manager; never reject (D2).
    hr_status = models.CharField(
        max_length=12, choices=LeaveStageStatus.choices, default=LeaveStageStatus.PENDING
    )
    hr_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_hr_decisions",
    )
    hr_decided_at = models.DateTimeField(null=True, blank=True)
    hr_comment = models.TextField(blank=True)

    # The most recent decision of either stage, kept so existing readers and
    # the "last thing that happened" display do not have to know the stages.
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_comment = models.TextField(blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "leave_requests"
        ordering = ("-start_date", "-applied_at")
        indexes = [
            models.Index(fields=("employee", "status")),
            models.Index(fields=("status", "start_date")),
        ]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.leave_type.code} {self.start_date}"

    @property
    def is_pending(self) -> bool:
        """Awaiting either stage - the days are still reserved."""
        return self.status in LEAVE_PENDING_STATES

    @property
    def is_decided(self) -> bool:
        return self.status in {LeaveStatus.APPROVED, LeaveStatus.REJECTED}

    @property
    def awaits_manager(self) -> bool:
        return self.status == LeaveStatus.PENDING_MANAGER

    @property
    def awaits_hr(self) -> bool:
        return self.status == LeaveStatus.PENDING_HR

    @property
    def year(self) -> int:
        return self.start_date.year


class LeaveRequestCC(TimeStampedModel):
    """Someone copied in on a request.

    A table rather than a bare M2M so the notification can be recorded - "was
    this person actually told?" is the question people ask afterwards. Being
    copied in grants **no** extra access to the request itself.
    """

    leave_request = models.ForeignKey(
        LeaveRequest, on_delete=models.CASCADE, related_name="cc_recipients"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="leave_cc"
    )
    notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "leave_request_cc"
        ordering = ("user__first_name", "user__last_name")
        constraints = [
            models.UniqueConstraint(fields=("leave_request", "user"), name="uniq_leave_cc")
        ]

    def __str__(self) -> str:
        return f"{self.leave_request_id} cc {self.user_id}"


class LeaveApproval(TimeStampedModel):
    """Every decision taken on a request, kept as history rather than a field."""

    class Action(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        MANAGER_APPROVED = "manager_approved", "Approved by manager"
        HR_APPROVED = "hr_approved", "Approved by HR"
        SENT_BACK = "sent_back", "Sent back to manager"

    leave_request = models.ForeignKey(
        LeaveRequest, on_delete=models.CASCADE, related_name="approvals"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "leave_approvals"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.leave_request_id} {self.action}"
