"""Two-stage leave approval: Employee -> Manager -> HR.

Two decisions drive every test here:

* **D1** - the balance is debited on **HR** approval only. A manager approving
  moves the request forward and nothing else. Get this wrong and someone's
  entitlement is spent by a decision that was never final.
* **D2** - HR has no Reject. Disagreement goes back to the manager with a
  reason, so the request stays alive.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from apps.leave_management.models import LeaveApproval, LeaveRequest
from apps.leave_management.services import (
    apply_for_leave,
    cancel_leave,
    get_or_create_balance,
    hr_approve,
    hr_send_back,
    manager_approve,
    manager_reject,
)
from apps.notifications.models import Notification
from common.enums import LeaveStageStatus, LeaveStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError


@pytest.fixture
def request_pending_manager(org, leave_type, next_monday):
    """A fresh two-day request, sitting with the manager."""
    return apply_for_leave(
        org["employee"], leave_type, next_monday, next_monday + timedelta(days=1), "Two days off."
    )


@pytest.fixture
def request_pending_hr(org, request_pending_manager):
    manager_approve(request_pending_manager.pk, org["manager"].user, "Fine by me.")
    return LeaveRequest.objects.get(pk=request_pending_manager.pk)


def balance_of(org, leave_type, next_monday):
    return get_or_create_balance(org["employee"], leave_type, next_monday.year)


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_new_request_waits_on_the_manager(request_pending_manager):
    assert request_pending_manager.status == LeaveStatus.PENDING_MANAGER
    assert request_pending_manager.manager_status == LeaveStageStatus.PENDING
    assert request_pending_manager.hr_status == LeaveStageStatus.PENDING


@pytest.mark.django_db
def test_manager_approval_hands_it_to_hr(org, request_pending_manager):
    updated = manager_approve(request_pending_manager.pk, org["manager"].user, "Fine by me.")

    assert updated.status == LeaveStatus.PENDING_HR
    assert updated.manager_status == LeaveStageStatus.APPROVED
    assert updated.manager_decided_by == org["manager"].user
    assert updated.manager_decided_at is not None
    assert updated.manager_comment == "Fine by me."
    assert updated.hr_status == LeaveStageStatus.PENDING


@pytest.mark.django_db
def test_hr_approval_closes_the_request(org, request_pending_hr):
    updated = hr_approve(request_pending_hr.pk, org["hr"].user, "Confirmed.")

    assert updated.status == LeaveStatus.APPROVED
    assert updated.hr_status == LeaveStageStatus.APPROVED
    assert updated.hr_decided_by == org["hr"].user
    assert updated.manager_status == LeaveStageStatus.APPROVED, "stage one must not be forgotten"


# ---------------------------------------------------------------------------
# D1: when the balance actually moves
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_manager_approving_spends_nothing(org, leave_type, next_monday, request_pending_hr):
    """Decision D1. The days are still only reserved."""
    balance = balance_of(org, leave_type, next_monday)

    assert balance.pending_days == Decimal("2")
    assert balance.used_days == Decimal("0")
    assert balance.available_days == Decimal("16")


@pytest.mark.django_db
def test_hr_approving_is_what_debits_the_balance(org, leave_type, next_monday, request_pending_hr):
    hr_approve(request_pending_hr.pk, org["hr"].user)

    balance = balance_of(org, leave_type, next_monday)
    assert balance.pending_days == Decimal("0")
    assert balance.used_days == Decimal("2")
    assert balance.available_days == Decimal("16"), "available is unchanged - only the split moves"


@pytest.mark.django_db
def test_a_send_back_leaves_the_balance_alone(org, leave_type, next_monday, request_pending_hr):
    hr_send_back(request_pending_hr.pk, org["hr"].user, "Please re-check the cover.")

    balance = balance_of(org, leave_type, next_monday)
    assert balance.pending_days == Decimal("2"), "the days stay reserved while it goes back"
    assert balance.used_days == Decimal("0")


@pytest.mark.django_db
def test_cancelling_at_the_hr_stage_releases_the_reservation(
    org, leave_type, next_monday, request_pending_hr
):
    cancel_leave(request_pending_hr.pk, org["employee"].user, "Changed my mind.")

    balance = balance_of(org, leave_type, next_monday)
    assert balance.pending_days == Decimal("0")
    assert balance.used_days == Decimal("0")
    assert balance.available_days == balance.entitled_days


# ---------------------------------------------------------------------------
# D2: rejection and send-back
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_manager_can_reject_outright(org, request_pending_manager):
    updated = manager_reject(request_pending_manager.pk, org["manager"].user, "No cover.")

    assert updated.status == LeaveStatus.REJECTED
    assert updated.manager_status == LeaveStageStatus.REJECTED
    assert updated.hr_status == LeaveStageStatus.PENDING, "HR never saw it"


@pytest.mark.django_db
def test_hr_cannot_reject_what_the_manager_approved(org, request_pending_hr):
    """D2: HR's disagreement is a send-back, not a rejection."""
    with pytest.raises(WorkflowStateError, match="waiting on the manager"):
        manager_reject(request_pending_hr.pk, org["hr"].user, "I disagree.")


@pytest.mark.django_db
def test_hr_sends_it_back_to_the_manager(org, request_pending_hr):
    updated = hr_send_back(request_pending_hr.pk, org["hr"].user, "Two others are off that week.")

    assert updated.status == LeaveStatus.PENDING_MANAGER
    assert updated.hr_status == LeaveStageStatus.SENT_BACK
    assert updated.hr_comment == "Two others are off that week."
    assert (
        updated.manager_status == LeaveStageStatus.PENDING
    ), "the manager decides again from scratch, rather than the old approval standing"


@pytest.mark.django_db
def test_a_send_back_needs_a_reason(org, request_pending_hr):
    with pytest.raises(BusinessRuleViolation, match="Say why"):
        hr_send_back(request_pending_hr.pk, org["hr"].user, "   ")


@pytest.mark.django_db
def test_a_sent_back_request_can_go_round_again(org, leave_type, next_monday, request_pending_hr):
    hr_send_back(request_pending_hr.pk, org["hr"].user, "Please re-check.")
    manager_approve(request_pending_hr.pk, org["manager"].user, "Checked - cover is fine.")
    final = hr_approve(request_pending_hr.pk, org["hr"].user)

    assert final.status == LeaveStatus.APPROVED
    assert balance_of(org, leave_type, next_monday).used_days == Decimal("2")


# ---------------------------------------------------------------------------
# Ordering: neither stage can be skipped
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_cannot_approve_before_the_manager(org, request_pending_manager):
    with pytest.raises(WorkflowStateError, match="already approved"):
        hr_approve(request_pending_manager.pk, org["hr"].user)


@pytest.mark.django_db
def test_the_manager_cannot_approve_twice(org, request_pending_hr):
    with pytest.raises(WorkflowStateError):
        manager_approve(request_pending_hr.pk, org["manager"].user)


@pytest.mark.django_db
def test_a_request_cannot_be_sent_back_before_hr_sees_it(org, request_pending_manager):
    with pytest.raises(WorkflowStateError, match="waiting on HR"):
        hr_send_back(request_pending_manager.pk, org["hr"].user, "Not yet mine to send back.")


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_every_stage_is_recorded_in_order(org, request_pending_hr):
    hr_send_back(request_pending_hr.pk, org["hr"].user, "Re-check.")
    manager_approve(request_pending_hr.pk, org["manager"].user)
    hr_approve(request_pending_hr.pk, org["hr"].user)

    actions = list(
        LeaveApproval.objects.filter(leave_request_id=request_pending_hr.pk)
        .order_by("created_at", "pk")
        .values_list("action", flat=True)
    )
    assert actions == [
        LeaveApproval.Action.MANAGER_APPROVED,
        LeaveApproval.Action.SENT_BACK,
        LeaveApproval.Action.MANAGER_APPROVED,
        LeaveApproval.Action.HR_APPROVED,
    ]


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_is_told_when_a_request_reaches_them(org, request_pending_manager):
    manager_approve(request_pending_manager.pk, org["manager"].user)

    note = Notification.objects.filter(recipient=org["hr"].user).first()
    assert note is not None
    assert "awaiting HR" in note.title


@pytest.mark.django_db
def test_a_manager_is_not_told_to_do_hr_work(org, request_pending_manager):
    """The stage-two notice goes to HR, not to everyone who can approve."""
    before = Notification.objects.filter(recipient=org["manager"].user).count()
    manager_approve(request_pending_manager.pk, org["manager"].user)

    after = Notification.objects.filter(
        recipient=org["manager"].user, title__contains="awaiting HR"
    ).count()
    assert after == 0
    assert Notification.objects.filter(recipient=org["manager"].user).count() == before


@pytest.mark.django_db
def test_the_employee_learns_their_request_moved_on(org, request_pending_manager):
    manager_approve(request_pending_manager.pk, org["manager"].user)

    note = Notification.objects.filter(recipient=org["employee"].user).first()
    assert "manager" in note.title
    assert note.level == Notification.Level.INFO, "not final yet, so not a success"


@pytest.mark.django_db
def test_a_send_back_tells_both_the_manager_and_the_employee(org, request_pending_hr):
    hr_send_back(request_pending_hr.pk, org["hr"].user, "Please re-check the cover.")

    manager_note = Notification.objects.filter(
        recipient=org["manager"].user, title__contains="sent back"
    ).first()
    employee_note = Notification.objects.filter(
        recipient=org["employee"].user, title__contains="sent back"
    ).first()

    assert manager_note is not None
    assert employee_note is not None
    assert "Please re-check the cover." in manager_note.message


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_approve_routes_to_the_right_stage(auth_client, org, request_pending_manager):
    """One endpoint, two stages: where the request is decides what happens."""
    url = f"/api/v1/leaves/{request_pending_manager.pk}/approve/"

    first = auth_client(org["manager"]).post(url, {"comment": "Fine."})
    assert first.status_code == 200
    assert first.data["status"] == LeaveStatus.PENDING_HR

    second = auth_client(org["hr"]).post(url, {"comment": "Confirmed."})
    assert second.status_code == 200
    assert second.data["status"] == LeaveStatus.APPROVED


@pytest.mark.django_db
def test_a_manager_cannot_clear_the_hr_stage(auth_client, org, request_pending_hr):
    """Otherwise a manager could take a request from applied to approved alone."""
    response = auth_client(org["manager"]).post(
        f"/api/v1/leaves/{request_pending_hr.pk}/approve/", {}
    )

    assert response.status_code == 403
    assert "second stage" in response.data["error"]["message"]


@pytest.mark.django_db
def test_a_manager_cannot_send_back(auth_client, org, request_pending_hr):
    response = auth_client(org["manager"]).post(
        f"/api/v1/leaves/{request_pending_hr.pk}/send-back/", {"comment": "Not mine to do."}
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_hr_sends_back_through_the_api(auth_client, org, request_pending_hr):
    response = auth_client(org["hr"]).post(
        f"/api/v1/leaves/{request_pending_hr.pk}/send-back/",
        {"comment": "Two others are off that week."},
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == LeaveStatus.PENDING_MANAGER
    assert response.data["hr_status"] == LeaveStageStatus.SENT_BACK


@pytest.mark.django_db
def test_the_api_refuses_a_send_back_with_no_reason(auth_client, org, request_pending_hr):
    response = auth_client(org["hr"]).post(
        f"/api/v1/leaves/{request_pending_hr.pk}/send-back/", {"comment": ""}
    )
    assert response.status_code == 400
    assert "comment" in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# The queues
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_manager_queue_holds_only_stage_one(auth_client, org, leave_type, next_monday):
    waiting = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Mine.")
    moved_on = apply_for_leave(org["peer"], leave_type, next_monday, next_monday, "Theirs.")
    manager_approve(moved_on.pk, org["manager"].user)

    response = auth_client(org["manager"]).get("/api/v1/leaves/pending-approvals/")
    ids = {row["id"] for row in response.data["results"]}
    assert ids == {waiting.pk}


@pytest.mark.django_db
def test_the_hr_queue_holds_only_stage_two(auth_client, org, leave_type, next_monday):
    apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Still with manager.")
    moved_on = apply_for_leave(org["peer"], leave_type, next_monday, next_monday, "With HR.")
    manager_approve(moved_on.pk, org["manager"].user)

    response = auth_client(org["hr"]).get("/api/v1/leaves/hr-approvals/")
    assert response.status_code == 200
    ids = {row["id"] for row in response.data["results"]}
    assert ids == {moved_on.pk}


@pytest.mark.django_db
def test_the_hr_queue_shows_the_applicants_remaining_balance(
    auth_client, org, leave_type, request_pending_hr
):
    response = auth_client(org["hr"]).get("/api/v1/leaves/hr-approvals/")

    row = response.data["results"][0]
    assert row["available_days"] == "16.0", "18 entitled, 2 reserved by this very request"
    assert row["entitled_days"] == "18.0"
    assert row["used_days"] == "0.0"


@pytest.mark.django_db
def test_the_hr_queue_is_not_open_to_managers(auth_client, org):
    response = auth_client(org["manager"]).get("/api/v1/leaves/hr-approvals/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_hr_queue_is_not_open_to_employees(auth_client, org):
    response = auth_client(org["employee"]).get("/api/v1/leaves/hr-approvals/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_stage_is_reported_for_the_timeline(auth_client, org, request_pending_hr):
    response = auth_client(org["employee"]).get(f"/api/v1/leaves/{request_pending_hr.pk}/")

    assert response.data["stage"] == "hr"
    assert response.data["manager_decided_by_name"] == org["manager"].full_name
    assert response.data["hr_decided_by_name"] is None


# ---------------------------------------------------------------------------
# HR does not reject (a business rule, not a hidden button)
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_cannot_reject_a_request_waiting_on_the_manager(
    auth_client, org, request_pending_manager
):
    """HR never rejects leave - it sends the request back instead.

    The UI does not offer HR the manager queue at all, but the rule has to hold
    at the API too: a hidden button is not a control.
    """
    response = auth_client(org["hr"]).post(
        f"/api/v1/leaves/{request_pending_manager.pk}/reject/", {"comment": "No."}
    )

    assert response.status_code == 403
    assert "does not reject" in response.data["error"]["message"]
    assert "back to the reporting" in response.data["error"]["message"]


@pytest.mark.django_db
def test_the_request_is_untouched_by_the_attempt(auth_client, org, request_pending_manager):
    auth_client(org["hr"]).post(
        f"/api/v1/leaves/{request_pending_manager.pk}/reject/", {"comment": "No."}
    )

    request_pending_manager.refresh_from_db()
    assert request_pending_manager.status == LeaveStatus.PENDING_MANAGER
    assert request_pending_manager.manager_status == LeaveStageStatus.PENDING


@pytest.mark.django_db
def test_the_manager_can_still_reject(auth_client, org, request_pending_manager):
    """Narrowing HR must not have narrowed the person the rule belongs to."""
    response = auth_client(org["manager"]).post(
        f"/api/v1/leaves/{request_pending_manager.pk}/reject/", {"comment": "No cover."}
    )

    assert response.status_code == 200
    assert response.data["status"] == LeaveStatus.REJECTED


@pytest.mark.django_db
def test_send_back_remains_hr_s_way_of_disagreeing(auth_client, org, request_pending_hr):
    response = auth_client(org["hr"]).post(
        f"/api/v1/leaves/{request_pending_hr.pk}/send-back/",
        {"comment": "Two others are off that week."},
    )

    assert response.status_code == 200
    assert response.data["status"] == LeaveStatus.PENDING_MANAGER
