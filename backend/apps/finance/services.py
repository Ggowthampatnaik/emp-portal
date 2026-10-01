"""Payslip release workflow.

    HR processes  -> with Finance
    Finance approves -> released
    Finance queries  -> back to HR, with a comment

Finance has no "reject": a payslip it disagrees with goes back to HR to be
looked at again, so the money keeps moving rather than dead-ending. That is the
same reasoning as HR's send-back on leave (decision D2).

Nothing here changes an amount. Payroll owns the figures; Finance only decides
whether they are released.
"""

import logging

from django.db import transaction
from django.utils import timezone

from apps.finance.models import PayslipApproval
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.payroll.models import PayrollRun, Payslip
from common.exceptions import BusinessRuleViolation, WorkflowStateError
from common.humanize import inr

logger = logging.getLogger("empportal.finance")


def finance_users():
    """Whoever can release payslips today - a role, not a person."""
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    from common.enums import RoleSlug

    return (
        get_user_model()
        .objects.filter(is_active=True)
        .filter(
            Q(user_roles__role__permissions__code="finance.approve")
            | Q(user_roles__role__slug=RoleSlug.SUPER_ADMIN)
        )
        .distinct()
    )


def approval_for(payslip: Payslip) -> PayslipApproval:
    """The payslip's release record, created on first sight."""
    approval, _ = PayslipApproval.objects.get_or_create(payslip=payslip)
    return approval


@transaction.atomic
def process_payslip(payslip_id: int, actor, comment: str = "") -> PayslipApproval:
    """HR pushes one payslip to Finance."""
    payslip = (
        Payslip.objects.select_related("run", "employee__user")
        .select_for_update()
        .get(pk=payslip_id)
    )

    # The run-level approval comes first: Finance should never be asked to
    # release money out of a month nobody has signed off.
    if payslip.run.status not in {PayrollRun.Status.APPROVED, PayrollRun.Status.PAID}:
        raise BusinessRuleViolation(
            f"{payslip.run.period_label} has not been approved yet. An administrator "
            "signs off the run before individual payslips go to Finance."
        )

    approval = approval_for(payslip)
    if approval.status == PayslipApproval.Status.APPROVED:
        raise WorkflowStateError("This payslip has already been released by Finance.")
    if approval.status == PayslipApproval.Status.PROCESSED:
        raise WorkflowStateError("This payslip is already with Finance.")

    approval.status = PayslipApproval.Status.PROCESSED
    approval.processed_by = actor
    approval.processed_at = timezone.now()
    approval.comment = comment
    approval.save(update_fields=["status", "processed_by", "processed_at", "comment", "updated_at"])

    for user in finance_users():
        notify(
            user,
            title=f"Payslip to release: {payslip.employee.full_name}",
            message=(
                f"{payslip.employee.full_name}'s payslip for {payslip.run.period_label} "
                f"(net {inr(payslip.net_pay)}) has been processed by HR and is waiting for "
                "Finance to release it."
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.INFO,
            link="/finance",
        )

    logger.info(
        "%s pushed %s to finance", getattr(actor, "email", "system"), payslip.employee.employee_code
    )
    return approval


def _load_with_finance(approval_id: int) -> PayslipApproval:
    approval = (
        PayslipApproval.objects.select_for_update()
        .select_related("payslip__run", "payslip__employee__user", "processed_by")
        .get(pk=approval_id)
    )
    if not approval.awaits_finance:
        raise WorkflowStateError(
            f"This payslip is {approval.get_status_display().lower()}, not with Finance."
        )
    return approval


@transaction.atomic
def release_payslip(approval_id: int, actor, comment: str = "") -> PayslipApproval:
    """Finance releases the payslip for payment."""
    approval = _load_with_finance(approval_id)

    if approval.processed_by_id and approval.processed_by_id == getattr(actor, "pk", None):
        raise BusinessRuleViolation(
            "You processed this payslip, so someone else has to release it."
        )

    approval.status = PayslipApproval.Status.APPROVED
    approval.approved_by = actor
    approval.approved_at = timezone.now()
    if comment:
        approval.comment = comment
    approval.save(update_fields=["status", "approved_by", "approved_at", "comment", "updated_at"])

    payslip = approval.payslip
    notify(
        payslip.employee.user,
        title=f"Payslip released for {payslip.run.period_label}",
        message=(
            f"Your payslip for {payslip.run.period_label} has been released. "
            f"Net pay {inr(payslip.net_pay)}."
        ),
        kind=Notification.Kind.GENERAL,
        level=Notification.Level.SUCCESS,
        link="/payroll",
    )
    if approval.processed_by_id:
        notify(
            approval.processed_by,
            title=f"Released: {payslip.employee.full_name}",
            message=(
                f"Finance has released {payslip.employee.full_name}'s payslip for "
                f"{payslip.run.period_label}."
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.SUCCESS,
            link="/payroll",
        )
    return approval


@transaction.atomic
def query_payslip(approval_id: int, actor, comment: str) -> PayslipApproval:
    """Finance sends the payslip back to HR with a question."""
    approval = _load_with_finance(approval_id)

    if not comment.strip():
        raise BusinessRuleViolation("Say what the query is - HR has to act on it.")

    approval.status = PayslipApproval.Status.QUERIED
    approval.approved_by = None
    approval.approved_at = None
    approval.comment = comment
    approval.save(update_fields=["status", "approved_by", "approved_at", "comment", "updated_at"])

    payslip = approval.payslip
    if approval.processed_by_id:
        notify(
            approval.processed_by,
            title=f"Finance queried: {payslip.employee.full_name}",
            message=(
                f"Finance has raised a query on {payslip.employee.full_name}'s payslip for "
                f"{payslip.run.period_label}.\n\nQuery: {comment}"
            ),
            kind=Notification.Kind.GENERAL,
            level=Notification.Level.WARNING,
            link="/payroll",
        )

    logger.info("%s queried payslip %s", getattr(actor, "email", "system"), approval.payslip_id)
    return approval
