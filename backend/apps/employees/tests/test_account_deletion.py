"""Account closure: HR asks, an administrator decides (F16).

The word "delete" in the requirement is a trap, and these tests exist mostly to
hold the line against it: approving **deactivates**. Somebody's payslips are a
statutory record and their leave history is what the next audit asks about, so
the one thing that must never happen is a row disappearing.

The second rule is maker-checker: whoever raised the request cannot be the one
who grants it.
"""

import pytest

from apps.administration.models import AuditLog
from apps.employees.models import AccountDeletionRequest
from apps.employees.services import (
    approve_account_deletion,
    reject_account_deletion,
    request_account_deletion,
)
from apps.notifications.models import Notification
from common.enums import AuditAction, EmploymentStatus, RoleSlug
from common.exceptions import BusinessRuleViolation, WorkflowStateError

QUEUE = "/api/v1/admin/deletion-requests/"


def request_url(employee) -> str:
    return f"/api/v1/employees/{employee.pk}/deletion-request/"


@pytest.fixture
def open_request(org):
    """HR has asked for the employee's account to be closed."""
    return request_account_deletion(org["employee"], org["hr"].user, "Resigned; last day passed.")


# ---------------------------------------------------------------------------
# Raising a request
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_raises_a_closure_request(auth_client, org):
    response = auth_client(org["hr"]).post(
        request_url(org["employee"]), {"reason": "Resigned; last working day was Friday."}
    )

    assert response.status_code == 201, response.data
    assert response.data["status"] == "pending"
    assert response.data["employee_code"] == "TRG0005"
    assert response.data["requested_by_name"] == org["hr"].full_name


@pytest.mark.django_db
def test_raising_one_does_not_touch_the_account(auth_client, org, open_request):
    """Asking is not deciding: nothing changes until an administrator acts."""
    org["employee"].refresh_from_db()
    org["employee"].user.refresh_from_db()

    assert org["employee"].employment_status == EmploymentStatus.ACTIVE
    assert org["employee"].user.is_active is True


@pytest.mark.django_db
def test_a_manager_cannot_raise_one(auth_client, org):
    response = auth_client(org["manager"]).post(
        request_url(org["employee"]), {"reason": "They report to me and have resigned."}
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_an_employee_cannot_raise_one(auth_client, org):
    response = auth_client(org["employee"]).post(
        request_url(org["peer"]), {"reason": "I do not like them very much."}
    )
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_a_reason_is_required(auth_client, org):
    response = auth_client(org["hr"]).post(request_url(org["employee"]), {"reason": "no"})
    assert response.status_code == 400
    assert "reason" in response.data["error"]["details"]


@pytest.mark.django_db
def test_you_cannot_ask_for_your_own_account_to_be_closed(org):
    with pytest.raises(BusinessRuleViolation, match="your own account"):
        request_account_deletion(org["hr"], org["hr"].user, "I am leaving on Friday.")


@pytest.mark.django_db
def test_only_one_request_can_be_open_at_a_time(auth_client, org, open_request):
    response = auth_client(org["hr"]).post(
        request_url(org["employee"]), {"reason": "Asking a second time for good measure."}
    )

    assert response.status_code == 409, "a domain rule refusing is a conflict, not bad input"
    assert "already waiting" in response.data["error"]["message"]


@pytest.mark.django_db
def test_an_already_inactive_account_cannot_be_closed_again(org):
    employee = org["employee"]
    employee.employment_status = EmploymentStatus.INACTIVE
    employee.save(update_fields=["employment_status"])

    with pytest.raises(BusinessRuleViolation, match="already inactive"):
        request_account_deletion(employee, org["hr"].user, "Tidying up old accounts.")


@pytest.mark.django_db
def test_hr_can_withdraw_its_own_request(auth_client, org, open_request):
    response = auth_client(org["hr"]).delete(request_url(org["employee"]))

    assert response.status_code == 204
    open_request.refresh_from_db()
    assert open_request.status == AccountDeletionRequest.Status.CANCELLED


@pytest.mark.django_db
def test_the_administrator_is_told(org, open_request):
    note = Notification.objects.filter(recipient=org["admin"].user).first()

    assert note is not None
    assert "closure requested" in note.title
    assert "Nothing is deleted" in note.message


# ---------------------------------------------------------------------------
# Deciding
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_administrator_approves_and_the_account_is_deactivated(auth_client, org, open_request):
    response = auth_client(org["admin"]).post(
        f"{QUEUE}{open_request.pk}/approve/", {"note": "Confirmed with the manager."}
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == "approved"

    org["employee"].refresh_from_db()
    org["employee"].user.refresh_from_db()
    assert org["employee"].employment_status == EmploymentStatus.INACTIVE
    assert org["employee"].user.is_active is False


@pytest.mark.django_db
def test_a_rejected_request_leaves_the_employee_active(auth_client, org, open_request):
    response = auth_client(org["admin"]).post(
        f"{QUEUE}{open_request.pk}/reject/", {"note": "They are transferring, not leaving."}
    )

    assert response.status_code == 200
    assert response.data["status"] == "rejected"

    org["employee"].refresh_from_db()
    org["employee"].user.refresh_from_db()
    assert org["employee"].employment_status == EmploymentStatus.ACTIVE
    assert org["employee"].user.is_active is True


@pytest.mark.django_db
def test_declining_needs_a_reason(auth_client, org, open_request):
    response = auth_client(org["admin"]).post(f"{QUEUE}{open_request.pk}/reject/", {"note": ""})

    assert response.status_code == 409
    assert "Say why" in response.data["error"]["message"]


@pytest.mark.django_db
def test_hr_cannot_decide_on_its_own_request(auth_client, org, open_request):
    """HR has no `employee.approve_deletion`, so the queue is closed to them."""
    assert auth_client(org["hr"]).get(QUEUE).status_code == 403
    assert auth_client(org["hr"]).post(f"{QUEUE}{open_request.pk}/approve/", {}).status_code == 403


@pytest.mark.django_db
def test_even_a_super_admin_cannot_approve_what_they_asked_for(org, make_user, make_employee):
    """Maker-checker. A Super Admin holds both permissions, so the rule is in
    the service rather than in the permission split alone."""
    root = make_user("root.deletion@trigyan.io", RoleSlug.SUPER_ADMIN)
    make_employee(root, employee_code="TRG9100")

    raised = request_account_deletion(org["employee"], root, "Leaving the company.")

    with pytest.raises(BusinessRuleViolation, match="someone else has to decide"):
        approve_account_deletion(raised.pk, root)


@pytest.mark.django_db
def test_a_decided_request_cannot_be_decided_again(org, open_request):
    approve_account_deletion(open_request.pk, org["admin"].user)

    with pytest.raises(WorkflowStateError, match="already been approved"):
        reject_account_deletion(open_request.pk, org["admin"].user, "Changed my mind.")


@pytest.mark.django_db
def test_hr_is_told_what_was_decided(org, open_request):
    approve_account_deletion(open_request.pk, org["admin"].user)

    note = Notification.objects.filter(
        recipient=org["hr"].user, title__contains="Account closed"
    ).first()
    assert note is not None
    assert "untouched" in note.message


# ---------------------------------------------------------------------------
# What approval must NOT do
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_approval_blocks_login_but_keeps_every_record(
    auth_client,
    api_client,
    org,
    leave_type,
    allocated_project,
    next_monday,
    past_monday,
    approve_leave,
):
    """The point of the whole feature: access goes, history stays."""
    from decimal import Decimal

    from apps.leave_management.models import LeaveRequest
    from apps.leave_management.services import apply_for_leave
    from apps.payroll.models import Payslip
    from apps.timesheets.models import Timesheet
    from apps.timesheets.services import get_or_create_timesheet, save_entries

    employee = org["employee"]

    leave = apply_for_leave(employee, leave_type, next_monday, next_monday, "A day off.")
    approve_leave(leave.pk)
    # Hours go in a past week; leave above is rightly in the future.
    sheet = get_or_create_timesheet(employee, past_monday)
    save_entries(
        sheet,
        [
            {
                "project": allocated_project,
                "work_date": past_monday,
                "hours": Decimal("8"),
                "description": "Sprint work",
            }
        ],
    )

    raised = request_account_deletion(employee, org["hr"].user, "Resigned.")
    approve_account_deletion(raised.pk, org["admin"].user)

    # Access is gone. Sign-in answers the same 400 it gives an unknown address,
    # so a closed account cannot be told apart from one that never existed.
    login = api_client.post(
        "/api/v1/auth/login/", {"email": employee.email, "password": "Fixture@123"}
    )
    assert login.status_code == 400

    # Everything they did is still there.
    assert LeaveRequest.objects.filter(pk=leave.pk).exists()
    assert Timesheet.objects.filter(pk=sheet.pk).exists()
    assert Timesheet.objects.get(pk=sheet.pk).entries.count() == 1
    assert Payslip.objects.filter(employee=employee).count() == 0  # none existed; none created
    assert employee.__class__.objects.filter(pk=employee.pk).exists(), "the row must survive"


@pytest.mark.django_db
def test_the_employee_row_is_never_removed(org, open_request):
    from apps.employees.models import Employee

    approve_account_deletion(open_request.pk, org["admin"].user)

    assert Employee.objects.filter(pk=org["employee"].pk).exists()
    assert AccountDeletionRequest.objects.filter(pk=open_request.pk).exists()


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_queue_lists_open_requests_with_the_context_to_judge_them(
    auth_client, org, open_request
):
    response = auth_client(org["admin"]).get(QUEUE, {"status": "pending"})

    assert response.status_code == 200
    row = response.data["results"][0]
    assert row["employee_name"] == org["employee"].full_name
    assert row["department_name"] == "Engineering"
    assert row["reason"] == "Resigned; last day passed."
    assert row["requested_by_name"] == org["hr"].full_name
    assert row["is_open"] is True


@pytest.mark.django_db
def test_a_manager_cannot_see_the_queue(auth_client, org):
    assert auth_client(org["manager"]).get(QUEUE).status_code == 403


@pytest.mark.django_db
def test_an_employee_cannot_see_the_queue(auth_client, org):
    assert auth_client(org["employee"]).get(QUEUE).status_code == 403


@pytest.mark.django_db
def test_hr_can_read_back_what_it_asked_for(auth_client, org, open_request):
    """The employee record needs to show that a request is already in flight."""
    response = auth_client(org["hr"]).get(request_url(org["employee"]))

    assert response.status_code == 200
    assert response.data["is_open"] is True


@pytest.mark.django_db
def test_an_employee_with_no_request_answers_404(auth_client, org):
    response = auth_client(org["hr"]).get(request_url(org["peer"]))
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_raising_and_deciding_are_both_audited(auth_client, org):
    client = auth_client(org["hr"])
    client.post(request_url(org["employee"]), {"reason": "Resigned; last day was Friday."})
    raised = AccountDeletionRequest.objects.get(employee=org["employee"])

    auth_client(org["admin"]).post(f"{QUEUE}{raised.pk}/approve/", {"note": "Confirmed."})

    entries = AuditLog.objects.filter(entity_type="AccountDeletionRequest").order_by("created_at")
    assert [entry.action for entry in entries] == [AuditAction.SUBMIT, AuditAction.APPROVE]
    assert entries.last().actor_email == org["admin"].email
