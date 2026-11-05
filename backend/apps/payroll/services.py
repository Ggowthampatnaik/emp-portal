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
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from apps.employees.models import Employee
from apps.leave_management.models import LeaveRequest
from apps.payroll.models import PayrollRun, Payslip, SalaryStructure
from apps.timesheets.models import Timesheet
from apps.timesheets.services import week_start
from common.enums import ApprovalStatus, EmploymentStatus, LeaveStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError
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
    run.notes = ""  # whatever Finance sent it back for has been dealt with
    run.save()

    if skipped:
        logger.warning(
            "Payroll %s: %d employee(s) skipped for want of a salary structure: %s",
            run.period_label,
            len(skipped),
            ", ".join(skipped),
        )
    return run


def month_weeks(year: int, month: int) -> list[date]:
    """The Monday of every week with a working day in the month."""
    start, end = month_bounds(year, month)
    monday = week_start(start)
    if start.weekday() > 4:  # the month opens on a weekend, so not that week
        monday += timedelta(days=7)

    weeks = []
    while monday <= end:
        weeks.append(monday)
        monday += timedelta(days=7)
    return weeks


def unapproved_timesheets(run: PayrollRun) -> list[dict]:
    """Who is being paid for the month with a week HR has not approved.

    Only ever a warning. Pay does not depend on hours booked, and one late sheet
    should not hold up everyone's salary. Weeks before someone joined or after
    they left are not theirs to file.
    """
    weeks = month_weeks(run.year, run.month)
    slips = run.payslips.select_related("employee__user").order_by("employee__employee_code")
    approved = set(
        Timesheet.objects.filter(
            week_start_date__in=weeks,
            status=ApprovalStatus.APPROVED,
            employee_id__in=slips.values("employee_id"),
        ).values_list("employee_id", "week_start_date")
    )

    missing = []
    for slip in slips:
        employee = slip.employee
        count = sum(
            1
            for monday in weeks
            if monday + timedelta(days=4) >= employee.date_of_joining
            and (employee.date_of_exit is None or monday <= employee.date_of_exit)
            and (employee.pk, monday) not in approved
        )
        if count:
            missing.append(
                {
                    "employee_code": employee.employee_code,
                    "name": employee.full_name,
                    "weeks": count,
                }
            )
    return missing
