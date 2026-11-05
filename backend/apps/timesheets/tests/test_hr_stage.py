"""Timesheets are approved twice: by the manager, then by HR, as leave is."""

import pytest

from apps.notifications.models import Notification
from apps.timesheets.models import Timesheet, TimesheetApproval
from apps.timesheets.services import (
    approve_timesheet,
    hr_approve_all,
    hr_approve_timesheet,
    hr_send_back_timesheet,
    submit_timesheet,
)
from common.enums import ApprovalStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError


@pytest.fixture
def filed(org, allocated_project, past_monday):
    """A submitted week, waiting on the manager."""
    from apps.timesheets.services import get_or_create_timesheet, save_entries

    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(
        sheet,
        [
            {
                "project": allocated_project.pk,
                "work_date": past_monday,
                "hours": "8",
                "description": "Built the thing.",
            }
        ],
    )
    return submit_timesheet(sheet.pk, org["employee"].user)


@pytest.fixture
def with_hr(org, filed):
    return approve_timesheet(filed.pk, org["manager"].user, "Looks right.")


def decide(client, sheet, action: str, comment: str = ""):
    return client.post(f"/api/v1/timesheets/{sheet.pk}/{action}/", {"comment": comment})


# ---------------------------------------------------------------------------
# Stage one
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_manager_hands_it_to_hr(with_hr):
    assert with_hr.status == ApprovalStatus.PENDING_HR
    assert with_hr.is_locked is False, "the month is not closed until HR agrees"
    assert with_hr.is_editable is False, "nor can the employee change what was approved"


@pytest.mark.django_db
def test_the_employee_is_not_told_yet(org, with_hr):
    assert not Notification.objects.filter(
        recipient=org["employee"].user, title="Timesheet approved"
    ).exists()


@pytest.mark.django_db
def test_it_cannot_be_resubmitted_while_with_hr(org, with_hr):
    with pytest.raises(WorkflowStateError, match="already been submitted"):
        submit_timesheet(with_hr.pk, org["employee"].user)


@pytest.mark.django_db
def test_the_manager_cannot_give_the_second_approval(auth_client, org, with_hr):
    assert decide(auth_client(org["manager"]), with_hr, "approve").status_code == 403


@pytest.mark.django_db
def test_hr_cannot_give_the_first_approval(auth_client, org, filed):
    assert decide(auth_client(org["hr"]), filed, "approve").status_code == 403


# ---------------------------------------------------------------------------
# Stage two
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_approves_and_the_week_locks(auth_client, org, with_hr):
    response = decide(auth_client(org["hr"]), with_hr, "approve")

    assert response.status_code == 200, response.data
    with_hr.refresh_from_db()
    assert with_hr.status == ApprovalStatus.APPROVED
    assert with_hr.is_locked is True
    assert with_hr.decided_by == org["hr"].user


@pytest.mark.django_db
def test_the_employee_hears_when_hr_approves(org, with_hr):
    hr_approve_timesheet(with_hr.pk, org["hr"].user)

    assert Notification.objects.filter(
        recipient=org["employee"].user, title="Timesheet approved"
    ).exists()


@pytest.mark.django_db
def test_both_decisions_are_in_the_history(org, with_hr):
    hr_approve_timesheet(with_hr.pk, org["hr"].user)

    actions = set(TimesheetApproval.objects.values_list("action", flat=True))
    assert {
        TimesheetApproval.Action.APPROVED,
        TimesheetApproval.Action.HR_APPROVED,
    } <= actions


@pytest.mark.django_db
def test_a_sheet_not_with_hr_cannot_get_its_approval(org, filed):
    with pytest.raises(WorkflowStateError, match="not with HR"):
        hr_approve_timesheet(filed.pk, org["hr"].user)


@pytest.mark.django_db
def test_hr_cannot_approve_their_own_sheet(auth_client, org, with_hr):
    Timesheet.objects.filter(pk=with_hr.pk).update(employee=org["hr"])

    assert decide(auth_client(org["hr"]), with_hr, "approve").status_code == 403


# ---------------------------------------------------------------------------
# Sending back
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_sends_it_back_to_the_manager(auth_client, org, with_hr):
    response = decide(auth_client(org["hr"]), with_hr, "reject", "These hours look high.")

    assert response.status_code == 200, response.data
    with_hr.refresh_from_db()
    assert with_hr.status == ApprovalStatus.PENDING
    assert with_hr.decision_comment == "These hours look high."
    note = Notification.objects.get(recipient=org["manager"].user, title__contains="sent back")
    assert "These hours look high." in note.message


@pytest.mark.django_db
def test_the_manager_can_then_return_it_to_the_employee(auth_client, org, with_hr):
    hr_send_back_timesheet(with_hr.pk, org["hr"].user, "These hours look high.")

    response = decide(auth_client(org["manager"]), with_hr, "reject", "Please recheck Monday.")

    assert response.status_code == 200, response.data
    with_hr.refresh_from_db()
    assert with_hr.status == ApprovalStatus.REJECTED
    assert with_hr.is_editable is True


@pytest.mark.django_db
def test_sending_back_needs_a_reason(org, with_hr):
    with pytest.raises(BusinessRuleViolation, match="look at again"):
        hr_send_back_timesheet(with_hr.pk, org["hr"].user, "")


# ---------------------------------------------------------------------------
# Queues
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_each_stage_has_its_own_queue(auth_client, org, filed):
    url = "/api/v1/timesheets/pending-approvals/"

    assert auth_client(org["manager"]).get(url).data["count"] == 1
    assert auth_client(org["hr"]).get(url).data["count"] == 0

    approve_timesheet(filed.pk, org["manager"].user)

    assert auth_client(org["manager"]).get(url).data["count"] == 0
    assert auth_client(org["hr"]).get(url).data["count"] == 1


@pytest.mark.django_db
def test_an_employee_has_no_queue(auth_client, org):
    response = auth_client(org["employee"]).get("/api/v1/timesheets/pending-approvals/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_hr_can_clear_the_queue_at_once(auth_client, org, with_hr):
    response = auth_client(org["hr"]).post("/api/v1/timesheets/hr-approve-all/", {})

    assert response.status_code == 200, response.data
    assert response.data == {"approved": 1}
    with_hr.refresh_from_db()
    assert with_hr.status == ApprovalStatus.APPROVED


@pytest.mark.django_db
def test_clearing_the_queue_skips_their_own_sheet(org, with_hr):
    Timesheet.objects.filter(pk=with_hr.pk).update(employee=org["hr"])

    assert hr_approve_all(org["hr"].user) == 0


@pytest.mark.django_db
@pytest.mark.parametrize("person", ["manager", "employee", "admin"])
def test_only_hr_can_clear_the_queue(auth_client, org, person):
    response = auth_client(org[person]).post("/api/v1/timesheets/hr-approve-all/", {})

    assert response.status_code == 403
