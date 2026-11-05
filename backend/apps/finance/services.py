"""Payslip release workflow.

    HR sends the month   -> with Finance
    Finance releases     -> paid, a payslip or the whole month at a time
    Finance queries      -> one payslip back to HR, with a comment
    Finance sends back   -> the whole month back to HR, before any is released

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
from apps.notifications.services import notify, notify_many
from apps.payroll.models import PayrollRun, Payslip
from common.exceptions import BusinessRuleViolation, WorkflowStateError
from common.humanize import inr
from common.utils import lock_own_rows

logger = logging.getLogger("empportal.finance")


def users_holding(code: str):
    """Whoever can do something today - a role, not a person."""
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    from common.enums import RoleSlug

    return (
        get_user_model()
        .objects.filter(is_active=True)
        .filter(
            Q(user_roles__role__permissions__code=code)
            | Q(user_roles__role__slug=RoleSlug.SUPER_ADMIN)
        )
        .distinct()
    )


def finance_users():
    return users_holding("finance.approve")


def hr_users():
    return users_holding("payroll.push_to_finance")


def approval_for(payslip: Payslip) -> PayslipApproval:
    """The payslip's release record, created on first sight."""
    approval, _ = PayslipApproval.objects.get_or_create(payslip=payslip)
    return approval


@transaction.atomic
def send_run_to_finance(run_id: int, actor) -> PayrollRun:
    """HR's request to Finance to pay the month."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.PROCESSED:
        raise WorkflowStateError(
            f"Only a processed run can be sent to Finance; this one is "
            f"{run.get_status_display().lower()}."
        )

    now = timezone.now()
    PayslipApproval.objects.bulk_create(
        PayslipApproval(
            payslip=payslip,
            status=PayslipApproval.Status.PROCESSED,
            processed_by=actor,
            processed_at=now,
        )
        for payslip in run.payslips.all()
    )

    run.status = PayrollRun.Status.WITH_FINANCE
    run.sent_by = actor
    run.sent_at = now
    run.save(update_fields=["status", "sent_by", "sent_at", "updated_at"])

    notify_many(
        finance_users(),
        title=f"Payroll to release: {run.period_label}",
        message=(
            f"HR has sent {run.period_label} to Finance: {run.employee_count} payslips, "
            f"net {inr(run.total_net)}."
        ),
        kind=Notification.Kind.GENERAL,
        level=Notification.Level.INFO,
        link="/finance",
    )
    logger.info("%s sent %s to finance", getattr(actor, "email", "system"), run.period_label)
    return run


@transaction.atomic
def send_run_back(run_id: int, actor, comment: str) -> PayrollRun:
    """Finance returns the whole month to HR, to be corrected and reprocessed.

    Only while nothing has gone out. After that it is too late for the month as
    a whole, and a payslip with a problem is queried on its own.
    """
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.WITH_FINANCE:
        raise WorkflowStateError("Only a month with Finance can be sent back.")
    if not comment.strip():
        raise BusinessRuleViolation("Say what needs correcting before sending the month back.")

    approvals = PayslipApproval.objects.filter(payslip__run=run)
    if approvals.filter(status=PayslipApproval.Status.APPROVED).exists():
        raise BusinessRuleViolation(
            f"Some of {run.period_label} has already been released, so it cannot go back "
            "as a month. Query the payslip that is wrong instead."
        )
    approvals.delete()

    run.status = PayrollRun.Status.DRAFT
    run.notes = comment
    run.processed_by = None
    run.processed_at = None
    run.sent_by = None
    run.sent_at = None
    run.save(
        update_fields=[
            "status",
            "notes",
            "processed_by",
            "processed_at",
            "sent_by",
            "sent_at",
            "updated_at",
        ]
    )

    notify_many(
        hr_users(),
        title=f"Finance sent back {run.period_label}",
        message=f"Finance has returned {run.period_label} to HR.\n\nReason: {comment}",
        kind=Notification.Kind.GENERAL,
        level=Notification.Level.WARNING,
        link="/payroll",
    )
    return run


@transaction.atomic
def process_payslip(payslip_id: int, actor, comment: str = "") -> PayslipApproval:
    """HR puts one payslip in front of Finance, usually after answering a query."""
    payslip = (
        Payslip.objects.select_related("run", "employee__user")
        .select_for_update()
        .get(pk=payslip_id)
    )

    if payslip.run.status not in {PayrollRun.Status.WITH_FINANCE, PayrollRun.Status.PAID}:
        raise BusinessRuleViolation(
            f"{payslip.run.period_label} has not been sent to Finance yet. "
            "Send the month before raising one of its payslips."
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
        lock_own_rows(PayslipApproval.objects)
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
    """Finance releases one payslip for payment."""
    approval = _load_with_finance(approval_id)

    if approval.processed_by_id and approval.processed_by_id == getattr(actor, "pk", None):
        raise BusinessRuleViolation(
            "You processed this payslip, so someone else has to release it."
        )

    _release(approval, actor, comment)

    payslip = approval.payslip
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
    _settle_run(payslip.run_id, actor)
    return approval


def _release(approval: PayslipApproval, actor, comment: str = "") -> None:
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


def _settle_run(run_id: int, actor) -> PayrollRun:
    """Marks the month paid once Finance has released the last of its payslips."""
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    outstanding = run.payslips.exclude(finance_approval__status=PayslipApproval.Status.APPROVED)
    if run.status == PayrollRun.Status.WITH_FINANCE and not outstanding.exists():
        run.status = PayrollRun.Status.PAID
        run.paid_by = actor
        run.paid_at = timezone.now()
        run.save(update_fields=["status", "paid_by", "paid_at", "updated_at"])
    return run


@transaction.atomic
def release_run(run_id: int, actor) -> dict:
    """Finance's one click: pays everything in the month that is waiting.

    A queried payslip is held rather than holding up everyone else, and the
    month stays with Finance until it too has been released. So does a payslip
    this person sent, which someone else has to release.
    """
    run = PayrollRun.objects.select_for_update().get(pk=run_id)
    if run.status != PayrollRun.Status.WITH_FINANCE:
        raise WorkflowStateError(
            f"Only a month with Finance can be released; this one is "
            f"{run.get_status_display().lower()}."
        )
    if run.sent_by_id and run.sent_by_id == getattr(actor, "pk", None):
        raise BusinessRuleViolation("You sent this month, so someone else has to release it.")

    waiting = list(
        PayslipApproval.objects.filter(payslip__run=run, status=PayslipApproval.Status.PROCESSED)
        .exclude(processed_by=actor)
        .select_related("payslip__run", "payslip__employee__user")
    )
    if not waiting:
        raise BusinessRuleViolation(f"Nothing in {run.period_label} is waiting to be released.")

    for approval in waiting:
        _release(approval, actor)

    run = _settle_run(run.pk, actor)
    held = run.payslips.exclude(finance_approval__status=PayslipApproval.Status.APPROVED).count()

    notify_many(
        hr_users(),
        title=f"Finance released {run.period_label}",
        message=(
            f"{len(waiting)} payslips for {run.period_label} have been released."
            + (f" {held} held back." if held else "")
        ),
        kind=Notification.Kind.GENERAL,
        level=Notification.Level.SUCCESS,
        link="/payroll",
    )
    return {"released": len(waiting), "held": held, "status": run.status}


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

    # All of HR rather than whoever sent it: the month may have come across the
    # old way, from an administrator who cannot answer this.
    payslip = approval.payslip
    notify_many(
        hr_users(),
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
