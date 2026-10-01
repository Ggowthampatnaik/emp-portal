"""Finance models.

Table: payslip_approvals

Payroll works out **what** someone is paid; Finance decides **when it is
released**. Keeping that as its own app, with its own table, means Payroll never
has to know how Finance works - and the release history is auditable in its own
right rather than being a couple of extra columns on ``Payslip`` that get
overwritten.

The portal now has two approvals on the same money, which is confusing unless
they are named: an administrator approves the **run** (is the whole month's
calculation right?), then HR pushes each **payslip** to Finance, which releases
it. The UI labels both stages for exactly this reason.
"""

from django.conf import settings
from django.db import models

from apps.payroll.models import Payslip
from common.models import TimeStampedModel


class PayslipApproval(TimeStampedModel):
    """One payslip's journey from HR to Finance.

    ``queried`` is the send-back state, the same lesson as HR's leave
    send-back (decision D2): Finance disagreeing must not be a dead end, so it
    goes back to HR with a comment instead of being rejected outright.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for HR"
        PROCESSED = "processed", "With Finance"
        APPROVED = "approved", "Released"
        QUERIED = "queried", "Queried by Finance"

    payslip = models.OneToOneField(
        Payslip, on_delete=models.CASCADE, related_name="finance_approval"
    )
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True
    )

    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payslips_processed",
        help_text="The HR user who pushed this payslip to Finance.",
    )
    processed_at = models.DateTimeField(null=True, blank=True)

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payslips_released",
        help_text="The Finance user who released it for payment.",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "payslip_approvals"
        ordering = ("-processed_at", "-created_at")
        indexes = [models.Index(fields=("status", "-processed_at"))]

    def __str__(self) -> str:
        return f"{self.payslip} - {self.get_status_display()}"

    @property
    def awaits_finance(self) -> bool:
        return self.status == self.Status.PROCESSED

    @property
    def is_released(self) -> bool:
        return self.status == self.Status.APPROVED


#: Module-level alias so the OpenAPI enum can be named explicitly in settings.
PAYSLIP_APPROVAL_STATUS_CHOICES = PayslipApproval.Status.choices
