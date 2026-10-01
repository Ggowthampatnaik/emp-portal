"""Leave workflow rules: day counting, balance movement, and who may decide.

These are the rules that survived the move to two-stage approval unchanged.
The staging itself - who clears which stage, and when the balance actually
moves - lives in ``test_two_stage_approval.py``.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.leave_management.models import Holiday, LeaveRequest
from apps.leave_management.services import (
    apply_for_leave,
    cancel_leave,
    count_leave_days,
    get_or_create_balance,
    hr_approve,
    manager_approve,
    manager_reject,
)
from apps.notifications.models import Notification
from common.enums import LeaveStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError


def approve_fully(request_pk, manager, hr):
    """Both stages, for tests that only care about the end state."""
    manager_approve(request_pk, manager.user)
    return hr_approve(request_pk, hr.user)


# ---------------------------------------------------------------------------
# Day counting
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_weekends_do_not_consume_leave(next_monday):
    # Monday to the following Sunday: 5 working days, not 7.
    assert count_leave_days(next_monday, next_monday + timedelta(days=6)) == Decimal("5")


@pytest.mark.django_db
def test_company_holidays_do_not_consume_leave(next_monday):
    Holiday.objects.create(date=next_monday + timedelta(days=2), name="Founders Day")
    assert count_leave_days(next_monday, next_monday + timedelta(days=4)) == Decimal("4")


@pytest.mark.django_db
def test_optional_holidays_still_consume_leave(next_monday):
    Holiday.objects.create(
        date=next_monday + timedelta(days=2), name="Floating holiday", is_optional=True
    )
    assert count_leave_days(next_monday, next_monday + timedelta(days=4)) == Decimal("5")


@pytest.mark.django_db
def test_half_day_counts_as_half(next_monday):
    assert count_leave_days(next_monday, next_monday, LeaveRequest.DayPart.FIRST_HALF) == Decimal(
        "0.5"
    )


@pytest.mark.django_db
def test_half_day_across_a_range_is_rejected(next_monday):
    with pytest.raises(BusinessRuleViolation):
        count_leave_days(
            next_monday, next_monday + timedelta(days=1), LeaveRequest.DayPart.FIRST_HALF
        )


# ---------------------------------------------------------------------------
# Balance movement
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_applying_reserves_days_as_pending(org, leave_type, next_monday):
    employee = org["employee"]
    request = apply_for_leave(
        employee, leave_type, next_monday, next_monday + timedelta(days=2), "Family function."
    )

    balance = get_or_create_balance(employee, leave_type, next_monday.year)
    assert request.total_days == Decimal("3")
    assert balance.pending_days == Decimal("3")
    assert balance.used_days == Decimal("0")
    assert balance.available_days == Decimal("15")


@pytest.mark.django_db
def test_full_approval_moves_pending_days_into_used(org, leave_type, next_monday):
    employee = org["employee"]
    request = apply_for_leave(employee, leave_type, next_monday, next_monday, "One day off.")

    approved = approve_fully(request.pk, org["manager"], org["hr"])

    balance = get_or_create_balance(employee, leave_type, next_monday.year)
    assert approved.status == LeaveStatus.APPROVED
    assert balance.pending_days == Decimal("0")
    assert balance.used_days == Decimal("1")
    assert balance.available_days == Decimal("17")


@pytest.mark.django_db
def test_rejection_releases_the_reserved_days(org, leave_type, next_monday):
    employee, manager = org["employee"], org["manager"]
    request = apply_for_leave(
        employee, leave_type, next_monday, next_monday + timedelta(days=1), "Two days."
    )

    rejected = manager_reject(request.pk, manager.user, "Release week.")

    balance = get_or_create_balance(employee, leave_type, next_monday.year)
    assert rejected.status == LeaveStatus.REJECTED
    assert balance.pending_days == Decimal("0")
    assert balance.used_days == Decimal("0")
    assert balance.available_days == balance.entitled_days


@pytest.mark.django_db
def test_cancelling_future_approved_leave_returns_the_days(org, leave_type, next_monday):
    employee = org["employee"]
    request = apply_for_leave(employee, leave_type, next_monday, next_monday, "Day off.")
    approve_fully(request.pk, org["manager"], org["hr"])

    cancel_leave(request.pk, employee.user, "Plans changed.")

    balance = get_or_create_balance(employee, leave_type, next_monday.year)
    assert balance.used_days == Decimal("0")
    assert LeaveRequest.objects.get(pk=request.pk).status == LeaveStatus.CANCELLED


@pytest.mark.django_db
def test_insufficient_balance_is_refused(org, small_quota_leave_type, next_monday):
    """The quota is 3 days a year; a 4-working-day request cannot fit."""
    with pytest.raises(BusinessRuleViolation, match="Insufficient"):
        apply_for_leave(
            org["employee"],
            small_quota_leave_type,
            next_monday,
            next_monday + timedelta(days=3),
            "Too long.",
        )


@pytest.mark.django_db
def test_max_consecutive_days_is_enforced(org, short_leave_type, next_monday):
    with pytest.raises(BusinessRuleViolation, match="consecutive"):
        apply_for_leave(
            org["employee"],
            short_leave_type,
            next_monday,
            next_monday + timedelta(days=2),
            "Three days.",
        )


@pytest.mark.django_db
def test_overlapping_requests_are_refused(org, leave_type, next_monday):
    apply_for_leave(
        org["employee"], leave_type, next_monday, next_monday + timedelta(days=2), "First."
    )
    with pytest.raises(BusinessRuleViolation, match="already have"):
        apply_for_leave(
            org["employee"],
            leave_type,
            next_monday + timedelta(days=1),
            next_monday + timedelta(days=3),
            "Overlaps.",
        )


@pytest.mark.django_db
def test_a_request_waiting_on_hr_still_blocks_an_overlap(org, leave_type, next_monday):
    """Stage two is still "pending" as far as clashes are concerned."""
    request = apply_for_leave(
        org["employee"], leave_type, next_monday, next_monday + timedelta(days=2), "First."
    )
    manager_approve(request.pk, org["manager"].user)

    with pytest.raises(BusinessRuleViolation, match="already have"):
        apply_for_leave(
            org["employee"],
            leave_type,
            next_monday + timedelta(days=1),
            next_monday + timedelta(days=3),
            "Overlaps.",
        )


@pytest.mark.django_db
def test_weekend_only_request_is_refused(org, leave_type, next_monday):
    saturday = next_monday + timedelta(days=5)
    with pytest.raises(BusinessRuleViolation, match="no working days"):
        apply_for_leave(
            org["employee"], leave_type, saturday, saturday + timedelta(days=1), "Weekend."
        )


@pytest.mark.django_db
def test_a_decided_request_cannot_be_decided_again(org, leave_type, next_monday):
    request = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Day off.")
    approve_fully(request.pk, org["manager"], org["hr"])

    with pytest.raises(WorkflowStateError):
        manager_reject(request.pk, org["manager"].user, "Too late.")


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_manager_is_notified_on_application(org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Day off.")

    notification = Notification.objects.filter(recipient=org["manager"].user).first()
    assert notification is not None
    assert notification.kind == Notification.Kind.LEAVE_APPLIED
    assert "Asha" in notification.title


@pytest.mark.django_db
def test_the_employee_is_notified_on_final_approval(org, leave_type, next_monday):
    request = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Day off.")
    approve_fully(request.pk, org["manager"], org["hr"])

    confirmed = Notification.objects.filter(
        recipient=org["employee"].user, level=Notification.Level.SUCCESS
    ).first()
    assert confirmed is not None
    assert confirmed.kind == Notification.Kind.LEAVE_APPROVED
    assert "HR" in confirmed.message


# ---------------------------------------------------------------------------
# API: who may see and decide
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_employee_applies_through_the_api(auth_client, org, leave_type, next_monday):
    client = auth_client(org["employee"])
    response = client.post(
        "/api/v1/leaves/",
        {
            "leave_type": leave_type.pk,
            "start_date": next_monday.isoformat(),
            "end_date": next_monday.isoformat(),
            "reason": "Personal errand.",
        },
    )
    assert response.status_code == 201, response.data
    assert response.data["status"] == LeaveStatus.PENDING_MANAGER
    assert response.data["total_days"] == "1.0"


@pytest.mark.django_db
def test_an_employee_only_sees_their_own_requests(auth_client, org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Mine.")
    apply_for_leave(org["peer"], leave_type, next_monday, next_monday, "Theirs.")

    response = auth_client(org["employee"]).get("/api/v1/leaves/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["employee_code"] == "TRG0005"


@pytest.mark.django_db
def test_a_manager_sees_the_whole_branch(auth_client, org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Mine.")
    apply_for_leave(org["peer"], leave_type, next_monday, next_monday, "Theirs.")
    apply_for_leave(org["outsider"], leave_type, next_monday, next_monday, "Unrelated.")

    response = auth_client(org["manager"]).get("/api/v1/leaves/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_hr_sees_every_request(auth_client, org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Mine.")
    apply_for_leave(org["outsider"], leave_type, next_monday, next_monday, "Unrelated.")

    response = auth_client(org["hr"]).get("/api/v1/leaves/")
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_an_employee_cannot_approve(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(org["peer"], leave_type, next_monday, next_monday, "Theirs.")
    response = auth_client(org["employee"]).post(f"/api/v1/leaves/{request.pk}/approve/", {})
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_a_manager_cannot_approve_their_own_request(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(org["manager"], leave_type, next_monday, next_monday, "Mine.")
    response = auth_client(org["manager"]).post(f"/api/v1/leaves/{request.pk}/approve/", {})
    assert response.status_code == 403
    assert "your own" in response.data["error"]["message"]


@pytest.mark.django_db
def test_a_manager_cannot_approve_outside_their_branch(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(org["outsider"], leave_type, next_monday, next_monday, "Unrelated.")
    response = auth_client(org["manager"]).post(f"/api/v1/leaves/{request.pk}/approve/", {})
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_the_approval_queue_excludes_your_own_requests(auth_client, org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Report's.")
    apply_for_leave(org["manager"], leave_type, next_monday, next_monday, "Manager's own.")

    response = auth_client(org["manager"]).get("/api/v1/leaves/pending-approvals/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0005"}


@pytest.mark.django_db
def test_balances_endpoint_opens_missing_balances(auth_client, org, leave_type):
    response = auth_client(org["employee"]).get("/api/v1/leave-balances/me/")
    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["leave_type_code"] == "EL"
    assert response.data[0]["available_days"] == "18.0"


# ---------------------------------------------------------------------------
# Nothing is applied for after the fact
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_leave_cannot_be_applied_for_in_the_past(org, leave_type):
    """Leave is asked for, not reported. A backdated request used to be
    accepted, and opened a balance for whatever year it named."""
    yesterday = timezone.localdate() - timedelta(days=1)

    with pytest.raises(BusinessRuleViolation, match="cannot be applied for in the past"):
        apply_for_leave(org["employee"], leave_type, yesterday, yesterday, "Backdated.")


@pytest.mark.django_db
def test_a_request_starting_today_is_allowed(org, leave_type):
    """Somebody who wakes up ill applies that morning."""
    today = timezone.localdate()

    request = apply_for_leave(org["employee"], leave_type, today, today, "Fell ill overnight.")

    assert request.start_date == today


@pytest.mark.django_db
def test_a_request_that_starts_today_may_still_run_on(org, leave_type):
    today = timezone.localdate()

    request = apply_for_leave(
        org["employee"], leave_type, today, today + timedelta(days=2), "Family emergency."
    )

    assert request.start_date == today
