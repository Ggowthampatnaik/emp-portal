"""Payroll processing.

Processing a run recomputes every payslip from scratch, so it is safe to run
again after fixing a salary structure. The only inputs are:

* the salary structure in force on the last day of the month
* the working days in that month (weekends and company holidays excluded)
* approved **unpaid** leave taken in that month, which is deducted pro-rata

Every amount is written onto the payslip. Nothing is derived at read time, so a
later change to a salary structure cannot rewrite a payslip that has been paid.
"""

import calendar
import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from apps.employees.models import Employee
from apps.leave_management.models import LeaveRequest
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.payroll.models import PayrollRun, Payslip, SalaryStructure
from common.enums import EmploymentStatus, LeaveStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError
from common.humanize import inr
from common.utils import working_days

logger = logging.getLogger("empportal.payroll")

PENNY = Decimal("0.01")


def rupees(value: Decimal) -> Decimal:
    """Rounds to whole paise, half up - the convention payroll expects."""
    return Decimal(value).quantize(PENNY, rounding=ROUND_HALF_UP)


def month_bounds(year: int, month: int) -> tuple[date, date]:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def month_working_days(year: int, month: int) -> int:
    """Weekdays in the month, minus mandatory company holidays."""
    from apps.leave_management.models import Holiday

    start, end = month_bounds(year, month)
    holidays = set(
        Holiday.objects.filter(date__range=(start, end), is_optional=False).values_list(
            "date", flat=True
        )
    )
    return working_days(start, end, holidays)


def structure_in_force(employee: Employee, on: date) -> SalaryStructure | None:
    """The structure effective on ``on`` - the latest one that has started."""
    return (
        SalaryStructure.objects.filter(employee=employee, effective_from__lte=on)
        .order_by("-effective_from")
        .first()
    )


def unpaid_leave_days(employee: Employee, year: int, month: int) -> Decimal:
    """Approved days of *unpaid* leave falling inside the month.

    A request can straddle a month boundary, so the days are recounted for the
    part that lands in this month rather than taking ``total_days`` wholesale.
    """
    from apps.leave_management.services import count_leave_days

    start, end = month_bounds(year, month)
    requests = LeaveRequest.objects.filter(
        employee=employee,
        # Fully approved only: loss of pay is deducted once HR has confirmed it,
        # never while a request is still working its way through the stages.
        status=LeaveStatus.APPROVED,
        leave_type__is_paid=False,
        start_date__lte=end,
        end_date__gte=start,
    ).select_related("leave_type")

    total = Decimal("0")
    for request in requests:
        overlap_start = max(request.start_date, start)
        overlap_end = min(request.end_date, end)
        if request.start_date == overlap_start and request.end_date == overlap_end:
            total += request.total_days
        else:
            total += count_leave_days(overlap_start, overlap_end)
    return total


def build_payslip(
    run: PayrollRun, employee: Employee, structure: SalaryStructure, working: int
) -> Payslip:
    """Computes one payslip. Returns an unsaved instance."""
    lop = unpaid_leave_days(employee, run.year, run.month)
    lop = min(lop, Decimal(working))  # cannot lose more days than exist
    paid_days = Decimal(working) - lop

    gross_full = structure.gross_monthly
    ratio = (paid_days / Decimal(working)) if working else Decimal("0")

    def prorate(amount: Decimal) -> Decimal:
        return rupees(amount * ratio)

    basic = prorate(structure.basic)
    hra = prorate(structure.hra)
    conveyance = prorate(structure.conveyance_allowance)
    medical = prorate(structure.medical_allowance)
    special = prorate(structure.special_allowance)
    gross = basic + hra + conveyance + medical + special

    # Each component is rounded before summing, so the total can land a paisa
    # away from prorating the gross directly. The pay withheld is therefore
    # derived from the components rather than computed separately - that way
    # gross + lop always equals the full monthly gross, and the payslip
    # reconciles instead of being off by a paisa.
    lop_amount = max(rupees(gross_full - gross), Decimal("0.00"))

    deductions = (
        structure.provident_fund
        + structure.professional_tax
        + structure.income_tax
        + structure.other_deductions
    )

    return Payslip(
        run=run,
        employee=employee,
        salary_structure=structure,
        working_days=working,
        lop_days=lop,
        paid_days=paid_days,
        basic=basic,
        hra=hra,
        conveyance_allowance=conveyance,
        medical_allowance=medical,
        special_allowance=special,
        provident_fund=structure.provident_fund,
        professional_tax=structure.professional_tax,
        income_tax=structure.income_tax,
        other_deductions=structure.other_deductions,
        lop_amount=lop_amount,
        gross_earnings=gross,
        total_deductions=rupees(deductions),
        net_pay=rupees(gross - deductions),
    )


@transaction.atomic
def process_run(run_id: int, actor) -> PayrollRun:
    """Generates every payslip for the run, replacing any previous attempt."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.is_locked:
        raise WorkflowStateError(
            f"This run is {run.get_status_display().lower()} and can no longer be processed."
        )

    _, month_end = month_bounds(run.year, run.month)
    working = month_working_days(run.year, run.month)
    if working == 0:
        raise BusinessRuleViolation("That month contains no working days.")

    employees = (
        Employee.objects.filter(employment_status=EmploymentStatus.ACTIVE)
        .select_related("user")
        .order_by("employee_code")
    )

    payslips: list[Payslip] = []
    skipped: list[str] = []
    for employee in employees:
        structure = structure_in_force(employee, month_end)
        if structure is None:
            skipped.append(employee.employee_code)
            continue
        payslips.append(build_payslip(run, employee, structure, working))

    if not payslips:
        raise BusinessRuleViolation(
            "No employee has a salary structure effective for this month, so there "
            "is nothing to process."
        )

    run.payslips.all().delete()
    Payslip.objects.bulk_create(payslips)

    run.working_days = working
    run.employee_count = len(payslips)
    run.total_gross = rupees(sum((slip.gross_earnings for slip in payslips), Decimal("0")))
    run.total_deductions = rupees(sum((slip.total_deductions for slip in payslips), Decimal("0")))
    run.total_net = rupees(sum((slip.net_pay for slip in payslips), Decimal("0")))
    run.status = PayrollRun.Status.PROCESSED
    run.processed_by = actor
    run.processed_at = timezone.now()
    run.save()

    if skipped:
        logger.warning(
            "Payroll %s: %d employee(s) skipped for want of a salary structure: %s",
            run.period_label,
            len(skipped),
            ", ".join(skipped),
        )
    return run


@transaction.atomic
def approve_run(run_id: int, actor) -> PayrollRun:
    """Locks the run. Separation of duties: the approver is not the processor."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.PROCESSED:
        raise WorkflowStateError(
            f"Only a processed run can be approved; this one is "
            f"{run.get_status_display().lower()}."
        )
    if run.processed_by_id and run.processed_by_id == getattr(actor, "pk", None):
        raise BusinessRuleViolation(
            "Payroll must be approved by someone other than the person who processed it."
        )

    run.status = PayrollRun.Status.APPROVED
    run.approved_by = actor
    run.approved_at = timezone.now()
    run.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    return run


@transaction.atomic
def reject_run(run_id: int, actor, comment: str) -> PayrollRun:
    """Sends a processed run back to draft so it can be corrected."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.PROCESSED:
        raise WorkflowStateError("Only a processed run can be sent back.")
    if not comment:
        raise BusinessRuleViolation("Say what needs correcting before sending the run back.")

    run.status = PayrollRun.Status.DRAFT
    run.notes = comment
    run.processed_by = None
    run.processed_at = None
    run.save(update_fields=["status", "notes", "processed_by", "processed_at", "updated_at"])
    return run


@transaction.atomic
def mark_paid(run_id: int, actor) -> PayrollRun:
    """Marks an approved run as paid and tells everyone their payslip is ready."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.APPROVED:
        raise WorkflowStateError(
            f"Only an approved run can be marked paid; this one is "
            f"{run.get_status_display().lower()}."
        )

    run.status = PayrollRun.Status.PAID
    run.paid_at = timezone.now()
    run.save(update_fields=["status", "paid_at", "updated_at"])

    for slip in run.payslips.select_related("employee__user"):
        notify(
            slip.employee.user,
            title=f"Payslip for {run.period_label}",
            message=(
                f"Your payslip for {run.period_label} is available. "
                f"Net pay: {inr(slip.net_pay)}."
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.SUCCESS,
            link="/payroll",
        )
    return run
