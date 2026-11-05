"""Payroll from HR to Finance: no other approval stands between them.

HR processes the month and sends it, Finance releases it, and that is what
pays people and shows them their payslip.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from apps.finance.models import PayslipApproval
from apps.finance.services import (
    query_payslip,
    release_payslip,
    release_run,
    send_run_back,
    send_run_to_finance,
)
from apps.notifications.models import Notification
from apps.payroll.models import PayrollRun, SalaryStructure
from apps.payroll.services import month_weeks, process_run, unapproved_timesheets
from apps.timesheets.models import Timesheet
from common.enums import ApprovalStatus, RoleSlug
from common.exceptions import BusinessRuleViolation, WorkflowStateError


@pytest.fixture
def finance_user(make_user, make_employee):
    user = make_user("fatima.sheikh@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.FINANCE)
    make_employee(user, employee_code="TRG0011")
    return user


@pytest.fixture
def processed(org, structure, run):
    return process_run(run.pk, org["hr"].user)


@pytest.fixture
def two_people(org, structure, run):
    SalaryStructure.objects.create(
        employee=org["peer"], effective_from=structure.effective_from, basic=Decimal("1000")
    )
    return process_run(run.pk, org["hr"].user)


def url(run, action: str) -> str:
    return f"/api/v1/payroll-runs/{run.pk}/{action}/"


# ---------------------------------------------------------------------------
# HR sends
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_sends_the_whole_month(auth_client, org, two_people, finance_user):
    response = auth_client(org["hr"]).post(url(two_people, "send-to-finance"), {})

    assert response.status_code == 200, response.data
    assert response.data["status"] == PayrollRun.Status.WITH_FINANCE
    assert response.data["sent_by_name"] == org["hr"].user.full_name
    statuses = PayslipApproval.objects.values_list("status", flat=True)
    assert list(statuses) == [PayslipApproval.Status.PROCESSED] * 2


@pytest.mark.django_db
def test_finance_hears_once_for_the_month(org, two_people, finance_user):
    send_run_to_finance(two_people.pk, org["hr"].user)

    assert Notification.objects.filter(recipient=finance_user, link="/finance").count() == 1


@pytest.mark.django_db
def test_a_draft_cannot_be_sent(org, run):
    with pytest.raises(WorkflowStateError, match="Only a processed run"):
        send_run_to_finance(run.pk, org["hr"].user)


@pytest.mark.django_db
def test_a_month_cannot_be_sent_twice(org, processed):
    send_run_to_finance(processed.pk, org["hr"].user)

    with pytest.raises(WorkflowStateError, match="Only a processed run"):
        send_run_to_finance(processed.pk, org["hr"].user)


@pytest.mark.django_db
def test_a_month_with_finance_is_locked(org, processed):
    send_run_to_finance(processed.pk, org["hr"].user)

    with pytest.raises(WorkflowStateError):
        process_run(processed.pk, org["hr"].user)


@pytest.mark.django_db
@pytest.mark.parametrize("person", ["employee", "manager", "admin"])
def test_only_hr_can_send(auth_client, org, processed, person):
    response = auth_client(org[person]).post(url(processed, "send-to-finance"), {})

    assert response.status_code == 403


@pytest.mark.django_db
def test_no_administrator_approval_is_left(auth_client, org, processed):
    for route in ("approve", "reject", "mark-paid"):
        assert auth_client(org["admin"]).post(url(processed, route), {}).status_code == 404


def test_the_approval_permission_is_gone(db):
    from django.core.management import call_command

    from apps.authentication.models import ModulePermission

    call_command("seed_rbac", verbosity=0)
    assert not ModulePermission.objects.filter(code="payroll.approve").exists()


# ---------------------------------------------------------------------------
# Unapproved timesheets warn, and do not block
# ---------------------------------------------------------------------------
def fill_month(employee, run, status=ApprovalStatus.APPROVED):
    for monday in month_weeks(run.year, run.month):
        Timesheet.objects.create(employee=employee, week_start_date=monday, status=status)


@pytest.mark.django_db
def test_every_unapproved_week_is_counted(org, processed):
    assert unapproved_timesheets(processed) == [
        {
            "employee_code": org["employee"].employee_code,
            "name": org["employee"].full_name,
            "weeks": 5,  # July 2025: weeks of 30 Jun, 7, 14, 21 and 28 Jul
        }
    ]


@pytest.mark.django_db
def test_nobody_is_listed_once_hr_has_approved_it_all(org, processed):
    fill_month(org["employee"], processed)

    assert unapproved_timesheets(processed) == []


@pytest.mark.django_db
def test_a_sheet_still_with_hr_counts_as_unapproved(org, processed):
    fill_month(org["employee"], processed, ApprovalStatus.PENDING_HR)

    assert unapproved_timesheets(processed)[0]["weeks"] == 5


@pytest.mark.django_db
def test_weeks_before_someone_joined_are_not_theirs(org, processed):
    org["employee"].date_of_joining = (
        processed.payslips.get().created_at.date().replace(year=2025, month=7, day=21)
    )
    org["employee"].save()

    assert unapproved_timesheets(processed)[0]["weeks"] == 2


def test_a_month_opening_on_a_weekend_skips_that_week():
    weeks = month_weeks(2025, 11)  # 1 November 2025 was a Saturday

    assert weeks[0].isoformat() == "2025-11-03"
    assert all(day.weekday() == 0 for day in weeks)
    assert weeks[-1] + timedelta(days=6) >= weeks[-1]


@pytest.mark.django_db
def test_hr_sees_the_warning_before_sending(auth_client, org, processed):
    response = auth_client(org["hr"]).get(url(processed, "timesheet-check"))

    assert response.status_code == 200, response.data
    assert response.data["unapproved"][0]["weeks"] == 5


@pytest.mark.django_db
def test_unapproved_timesheets_do_not_stop_the_month(auth_client, org, processed):
    response = auth_client(org["hr"]).post(url(processed, "send-to-finance"), {})

    assert response.status_code == 200, response.data


# ---------------------------------------------------------------------------
# Finance releases the month
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_one_release_pays_the_month(auth_client, org, two_people, finance_user):
    send_run_to_finance(two_people.pk, org["hr"].user)

    response = auth_client(finance_user).post(url(two_people, "release"), {})

    assert response.status_code == 200, response.data
    assert response.data == {"released": 2, "held": 0, "status": PayrollRun.Status.PAID}
    two_people.refresh_from_db()
    assert two_people.status == PayrollRun.Status.PAID
    assert two_people.paid_by == finance_user
    assert two_people.paid_at is not None


@pytest.mark.django_db
def test_each_employee_is_told_once(org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)
    release_run(processed.pk, finance_user)

    note = Notification.objects.get(recipient=org["employee"].user)
    assert "released" in note.title


@pytest.mark.django_db
def test_hr_hears_the_month_went_out(org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)
    release_run(processed.pk, finance_user)

    assert Notification.objects.filter(
        recipient=org["hr"].user, title__contains="Finance released"
    ).exists()


@pytest.mark.django_db
def test_a_queried_payslip_is_held_and_the_rest_go_out(org, two_people, finance_user):
    send_run_to_finance(two_people.pk, org["hr"].user)
    query_payslip(
        PayslipApproval.objects.get(payslip__employee=org["peer"]).pk,
        finance_user,
        "This basic looks wrong.",
    )

    outcome = release_run(two_people.pk, finance_user)

    assert outcome == {"released": 1, "held": 1, "status": PayrollRun.Status.WITH_FINANCE}
    assert not Notification.objects.filter(
        recipient=org["peer"].user, title__contains="released"
    ).exists()


@pytest.mark.django_db
def test_releasing_the_held_payslip_finishes_the_month(org, two_people, finance_user):
    send_run_to_finance(two_people.pk, org["hr"].user)
    first, second = PayslipApproval.objects.all()

    release_payslip(first.pk, finance_user)
    two_people.refresh_from_db()
    assert two_people.status == PayrollRun.Status.WITH_FINANCE

    release_payslip(second.pk, finance_user)
    two_people.refresh_from_db()
    assert two_people.status == PayrollRun.Status.PAID
    assert two_people.paid_by == finance_user


@pytest.mark.django_db
def test_whoever_sent_it_cannot_release_it(org, processed):
    send_run_to_finance(processed.pk, org["hr"].user)

    with pytest.raises(BusinessRuleViolation, match="someone else"):
        release_run(processed.pk, org["hr"].user)


@pytest.mark.django_db
def test_a_month_not_sent_cannot_be_released(org, processed, finance_user):
    with pytest.raises(WorkflowStateError, match="Only a month with Finance"):
        release_run(processed.pk, finance_user)


@pytest.mark.django_db
def test_nothing_waiting_is_said_plainly(org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)
    query_payslip(PayslipApproval.objects.get().pk, finance_user, "This looks wrong.")

    with pytest.raises(BusinessRuleViolation, match="Nothing in"):
        release_run(processed.pk, finance_user)


@pytest.mark.django_db
@pytest.mark.parametrize("person", ["hr", "admin", "manager", "employee"])
def test_only_finance_can_release(auth_client, org, processed, person):
    send_run_to_finance(processed.pk, org["hr"].user)

    assert auth_client(org[person]).post(url(processed, "release"), {}).status_code == 403


# ---------------------------------------------------------------------------
# Finance sends the month back
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_finance_can_return_the_month_to_hr(auth_client, org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)

    response = auth_client(finance_user).post(
        url(processed, "send-back"), {"comment": "The special allowance is wrong."}
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == PayrollRun.Status.DRAFT
    assert "special allowance" in response.data["notes"]
    assert not PayslipApproval.objects.exists()
    assert Notification.objects.filter(
        recipient=org["hr"].user, title__contains="sent back"
    ).exists()


@pytest.mark.django_db
def test_sending_back_needs_a_reason(org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)

    with pytest.raises(BusinessRuleViolation, match="what needs correcting"):
        send_run_back(processed.pk, finance_user, "  ")


@pytest.mark.django_db
def test_a_month_partly_paid_cannot_go_back(org, two_people, finance_user):
    send_run_to_finance(two_people.pk, org["hr"].user)
    release_payslip(PayslipApproval.objects.first().pk, finance_user)

    with pytest.raises(BusinessRuleViolation, match="already been released"):
        send_run_back(two_people.pk, finance_user, "Too late.")


@pytest.mark.django_db
def test_hr_can_correct_it_and_send_again(org, processed, finance_user):
    send_run_to_finance(processed.pk, org["hr"].user)
    send_run_back(processed.pk, finance_user, "Reprocess this, please.")

    corrected = process_run(processed.pk, org["hr"].user)
    assert corrected.notes == "", "what Finance said no longer applies"

    assert send_run_to_finance(processed.pk, org["hr"].user).status == (
        PayrollRun.Status.WITH_FINANCE
    )


# ---------------------------------------------------------------------------
# What employees see
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_payslip_stays_hidden_until_finance_releases_it(
    auth_client, org, processed, finance_user
):
    client = auth_client(org["employee"])
    send_run_to_finance(processed.pk, org["hr"].user)
    assert client.get("/api/v1/payslips/me/").data == []

    release_run(processed.pk, finance_user)
    assert len(client.get("/api/v1/payslips/me/").data) == 1


@pytest.mark.django_db
def test_a_held_payslip_stays_hidden_while_colleagues_see_theirs(
    auth_client, org, two_people, finance_user
):
    send_run_to_finance(two_people.pk, org["hr"].user)
    query_payslip(
        PayslipApproval.objects.get(payslip__employee=org["peer"]).pk,
        finance_user,
        "This basic looks wrong.",
    )
    release_run(two_people.pk, finance_user)

    assert len(auth_client(org["employee"]).get("/api/v1/payslips/me/").data) == 1
    assert auth_client(org["peer"]).get("/api/v1/payslips/me/").data == []


@pytest.mark.django_db
def test_the_run_shows_where_each_payslip_is(auth_client, org, processed):
    client = auth_client(org["hr"])
    assert (
        client.get(f"/api/v1/payroll-runs/{processed.pk}/").data["payslips"][0]["finance_status"]
        is None
    )

    send_run_to_finance(processed.pk, org["hr"].user)

    assert (
        client.get(f"/api/v1/payroll-runs/{processed.pk}/").data["payslips"][0]["finance_status"]
        == PayslipApproval.Status.PROCESSED
    )
