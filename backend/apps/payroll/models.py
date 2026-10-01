"""Payroll models.

Tables: salary_structures, payroll_runs, payslips

Three ideas, in order:

* A **salary structure** is what an employee is paid, broken into monthly
  components. It is effective-dated, so a raise is a new row rather than an
  edit - last year's payslips must keep reconciling.
* A **payroll run** is one month being paid, with a maker-checker workflow:
  processed by HR, approved by an administrator, then marked paid.
* A **payslip** is one employee's outcome for one run. Every amount is copied
  onto it at processing time, so a later change to the salary structure can
  never rewrite history.
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.employees.models import Employee
from common.models import AuditableModel, TimeStampedModel

MONTHS = [
    (1, "January"),
    (2, "February"),
    (3, "March"),
    (4, "April"),
    (5, "May"),
    (6, "June"),
    (7, "July"),
    (8, "August"),
    (9, "September"),
    (10, "October"),
    (11, "November"),
    (12, "December"),
]

ZERO = Decimal("0.00")


def money(**kwargs):
    """A currency column: two decimal places, never negative."""
    kwargs.setdefault("max_digits", 12)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("default", ZERO)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


class SalaryStructure(AuditableModel):
    """What an employee is paid, from ``effective_from`` until superseded."""

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="salary_structures"
    )
    effective_from = models.DateField()
    effective_to = models.DateField(
        null=True, blank=True, help_text="Set automatically when a newer structure starts."
    )

    # Monthly earnings
    basic = money(help_text="Basic pay per month.")
    hra = money(help_text="House rent allowance per month.")
    conveyance_allowance = money()
    medical_allowance = money()
    special_allowance = money()

    # Monthly deductions
    provident_fund = money(help_text="Employee provident fund contribution.")
    professional_tax = money()
    income_tax = money(help_text="TDS deducted at source each month.")
    other_deductions = money()

    notes = models.TextField(blank=True)

    class Meta:
        db_table = "salary_structures"
        ordering = ("-effective_from",)
        constraints = [
            models.UniqueConstraint(
                fields=("employee", "effective_from"), name="uniq_structure_per_start"
            )
        ]
        indexes = [models.Index(fields=("employee", "-effective_from"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} from {self.effective_from}"

    @property
    def gross_monthly(self) -> Decimal:
        return (
            self.basic
            + self.hra
            + self.conveyance_allowance
            + self.medical_allowance
            + self.special_allowance
        )

    @property
    def deductions_monthly(self) -> Decimal:
        return self.provident_fund + self.professional_tax + self.income_tax + self.other_deductions

    @property
    def net_monthly(self) -> Decimal:
        return self.gross_monthly - self.deductions_monthly

    @property
    def annual_ctc(self) -> Decimal:
        return self.gross_monthly * 12

    @property
    def is_current(self) -> bool:
        return self.effective_to is None


class PayrollRun(TimeStampedModel):
    """One month of payroll, from draft to paid.

    draft -> processed -> approved -> paid, with rejection sending a processed
    run back to draft. Payslips exist only from ``processed`` onwards, and the
    run locks once approved.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PROCESSED = "processed", "Processed"
        APPROVED = "approved", "Approved"
        PAID = "paid", "Paid"

    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField(choices=MONTHS)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    notes = models.TextField(blank=True)

    working_days = models.PositiveSmallIntegerField(
        default=0, help_text="Working days in the month, excluding weekends and holidays."
    )
    employee_count = models.PositiveIntegerField(default=0)
    total_gross = money()
    total_deductions = money()
    total_net = money()

    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs_processed",
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payroll_runs"
        ordering = ("-year", "-month")
        constraints = [
            models.UniqueConstraint(fields=("year", "month"), name="uniq_payroll_run_per_month")
        ]

    def __str__(self) -> str:
        return f"{self.get_month_display()} {self.year} ({self.get_status_display()})"

    @property
    def period_label(self) -> str:
        return f"{self.get_month_display()} {self.year}"

    @property
    def is_editable(self) -> bool:
        """Only a draft or a freshly processed run may be reprocessed."""
        return self.status in {self.Status.DRAFT, self.Status.PROCESSED}

    @property
    def is_locked(self) -> bool:
        return self.status in {self.Status.APPROVED, self.Status.PAID}


# Module-level alias so the OpenAPI enum can be named explicitly in settings.
PAYROLL_STATUS_CHOICES = PayrollRun.Status.choices


class Payslip(TimeStampedModel):
    """One employee's pay for one run.

    Amounts are snapshots taken when the run was processed - never lookups
    against the current salary structure.
    """

    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="payslips")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payslips")
    salary_structure = models.ForeignKey(
        SalaryStructure, null=True, blank=True, on_delete=models.SET_NULL, related_name="payslips"
    )

    # Attendance basis
    working_days = models.PositiveSmallIntegerField(default=0)
    lop_days = models.DecimalField(max_digits=5, decimal_places=1, default=Decimal("0.0"))
    paid_days = models.DecimalField(max_digits=5, decimal_places=1, default=Decimal("0.0"))

    # Earnings (already pro-rated for unpaid leave)
    basic = money()
    hra = money()
    conveyance_allowance = money()
    medical_allowance = money()
    special_allowance = money()

    # Deductions
    provident_fund = money()
    professional_tax = money()
    income_tax = money()
    other_deductions = money()
    lop_amount = money(help_text="Pay withheld for unpaid leave taken in the month.")

    gross_earnings = money()
    total_deductions = money()
    net_pay = money()

    class Meta:
        db_table = "payslips"
        ordering = ("employee__employee_code",)
        constraints = [
            models.UniqueConstraint(fields=("run", "employee"), name="uniq_payslip_per_run")
        ]
        indexes = [models.Index(fields=("employee", "-created_at"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.run.period_label}"

    @property
    def period_label(self) -> str:
        return self.run.period_label
