"""HR submission tracking: who has filed a timesheet, and nudging those who have not."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.notifications.models import Notification
from apps.projects.models import ProjectAllocation, ProjectMember
from apps.timesheets.services import (
    approve_timesheet,
    get_or_create_timesheet,
    last_completed_week,
    notify_missing_timesheets,
    save_entries,
    submission_status_by_employee,
    submission_status_by_project,
    submit_timesheet,
    week_start,
)
from common.enums import EmploymentStatus
from common.humanize import human_date_short

BY_PROJECT = "/api/v1/timesheets/status/by-project/"
BY_EMPLOYEE = "/api/v1/timesheets/status/by-employee/"
NOTIFY = "/api/v1/timesheets/notify/"


@pytest.fixture
def past_week():
    """The week HR reports on: the one that finished before today."""
    return last_completed_week()


@pytest.fixture
def team(org, project, past_week):
    """The employee and the peer both on one project, allocated so they can book."""
    for employee in (org["employee"], org["peer"]):
        ProjectMember.objects.create(
            project=project, employee=employee, joined_on=project.start_date
        )
        ProjectAllocation.objects.create(
            project=project,
            employee=employee,
            allocation_percentage=Decimal("50"),
            start_date=project.start_date,
        )
    return project


def file_timesheet(employee, project, monday, *, submit=True, approve_by=None):
    sheet = get_or_create_timesheet(employee, monday)
    save_entries(
        sheet,
        [
            {
                "project": project,
                "work_date": monday,
                "hours": Decimal("8"),
                "description": "Sprint work",
            }
        ],
    )
    if submit:
        submit_timesheet(sheet.pk, employee.user)
    if approve_by:
        approve_timesheet(sheet.pk, approve_by)
    return sheet


# ---------------------------------------------------------------------------
# Which week
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_reporting_week_is_the_last_completed_one():
    today = timezone.localdate()
    week = last_completed_week()

    assert week.weekday() == 0, "always a Monday"
    assert week + timedelta(days=6) < today, "the week must already have finished"
    assert week == week_start(today) - timedelta(days=7)


# ---------------------------------------------------------------------------
# By employee
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_every_active_employee_appears_even_without_a_timesheet(org, past_week):
    rows = submission_status_by_employee(past_week)

    codes = {row["employee_code"] for row in rows}
    assert "TRG0005" in codes
    assert all(row["submitted"] is False for row in rows)
    assert all(row["timesheet_id"] is None for row in rows)


@pytest.mark.django_db
def test_a_submitted_timesheet_is_marked(org, team, past_week):
    file_timesheet(org["employee"], team, past_week)

    rows = {row["employee_code"]: row for row in submission_status_by_employee(past_week)}
    assert rows["TRG0005"]["submitted"] is True
    assert rows["TRG0005"]["status"] == "pending"
    assert rows["TRG0005"]["total_hours"] == Decimal("8.00")
    assert rows["TRG0006"]["submitted"] is False


@pytest.mark.django_db
def test_a_draft_does_not_count_as_submitted(org, team, past_week):
    file_timesheet(org["employee"], team, past_week, submit=False)

    row = next(
        r for r in submission_status_by_employee(past_week) if r["employee_code"] == "TRG0005"
    )
    assert row["status"] == "draft"
    assert row["submitted"] is False, "a draft is still sitting with the employee"


@pytest.mark.django_db
def test_an_approved_timesheet_counts_as_submitted(org, team, past_week):
    file_timesheet(org["employee"], team, past_week, approve_by=org["manager"].user)

    row = next(
        r for r in submission_status_by_employee(past_week) if r["employee_code"] == "TRG0005"
    )
    assert row["status"] == "approved"
    assert row["submitted"] is True


@pytest.mark.django_db
def test_employees_who_have_left_are_excluded(org, past_week):
    leaver = org["peer"]
    leaver.employment_status = EmploymentStatus.INACTIVE
    leaver.save(update_fields=["employment_status"])

    codes = {row["employee_code"] for row in submission_status_by_employee(past_week)}
    assert "TRG0006" not in codes


# ---------------------------------------------------------------------------
# By project
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_project_lists_its_team_with_counts(org, team, past_week):
    file_timesheet(org["employee"], team, past_week)

    row = next(r for r in submission_status_by_project(past_week) if r["project_code"] == "PRJ-001")
    assert row["team_size"] == 2
    assert row["submitted_count"] == 1
    assert row["pending_count"] == 1
    assert {e["employee_code"] for e in row["employees"]} == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_someone_who_left_the_project_drops_off_it(org, team, past_week):
    membership = ProjectMember.objects.get(project=team, employee=org["peer"])
    membership.left_on = past_week - timedelta(days=1)
    membership.save(update_fields=["left_on"])

    row = next(r for r in submission_status_by_project(past_week) if r["project_code"] == "PRJ-001")
    assert {e["employee_code"] for e in row["employees"]} == {"TRG0005"}


@pytest.mark.django_db
def test_cancelled_projects_are_left_out(org, team, past_week):
    from apps.projects.models import Project

    team.status = Project.Status.CANCELLED
    team.save(update_fields=["status"])

    assert submission_status_by_project(past_week) == []


@pytest.mark.django_db
def test_the_board_costs_the_same_whoever_is_on_the_project(
    django_assert_num_queries, org, team, past_week
):
    """A third member must not cost a third round trip."""
    with CaptureQueriesContext(connection) as first:
        submission_status_by_project(past_week)

    ProjectMember.objects.create(project=team, employee=org["outsider"], joined_on=team.start_date)

    with django_assert_num_queries(len(first)):
        rows = submission_status_by_project(past_week)

    assert rows[0]["team_size"] == 3


# ---------------------------------------------------------------------------
# Notify
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_only_the_non_submitters_are_nudged(org, team, past_week):
    file_timesheet(org["employee"], team, past_week)

    notified = notify_missing_timesheets(
        past_week, [org["employee"].pk, org["peer"].pk], org["hr"].user
    )

    assert notified == ["TRG0006"]
    assert not Notification.objects.filter(recipient=org["employee"].user).exists()
    note = Notification.objects.get(recipient=org["peer"].user)
    # The title carries the week in human copy ("24 Aug → 30 Aug 2026"),
    # never the ISO date the model stores.
    assert human_date_short(past_week) in note.title
    assert str(past_week) not in note.title
    assert note.level == Notification.Level.WARNING


@pytest.mark.django_db
def test_nudging_a_whole_project_through_the_api(auth_client, org, team, past_week):
    file_timesheet(org["employee"], team, past_week)

    response = auth_client(org["hr"]).post(
        NOTIFY, {"project": team.pk, "week": past_week.isoformat()}
    )
    assert response.status_code == 200, response.data
    assert response.data["notified"] == ["TRG0006"]
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_notify_needs_either_employees_or_a_project(auth_client, org):
    response = auth_client(org["hr"]).post(NOTIFY, {})
    assert response.status_code == 400
    assert "employee_ids" in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# Who may look, and who may nudge
# ---------------------------------------------------------------------------
@pytest.mark.django_db
@pytest.mark.parametrize("url", [BY_PROJECT, BY_EMPLOYEE])
def test_hr_may_see_the_boards(auth_client, org, team, past_week, url):
    response = auth_client(org["hr"]).get(url)
    assert response.status_code == 200
    assert response.data["week_start_date"] == past_week
    assert "results" in response.data


@pytest.mark.django_db
@pytest.mark.parametrize("url", [BY_PROJECT, BY_EMPLOYEE])
def test_an_employee_may_not(auth_client, org, url):
    assert auth_client(org["employee"]).get(url).status_code == 403


@pytest.mark.django_db
def test_a_manager_may_not_nudge(auth_client, org, team, past_week):
    """Reminders are HR's job; managers have their own approval queue."""
    response = auth_client(org["manager"]).post(NOTIFY, {"employee_ids": [org["employee"].pk]})
    assert response.status_code == 403


@pytest.mark.django_db
def test_an_explicit_week_is_honoured(auth_client, org, team):
    older = last_completed_week() - timedelta(days=7)
    response = auth_client(org["hr"]).get(BY_EMPLOYEE, {"week": older.isoformat()})

    assert response.status_code == 200
    assert response.data["week_start_date"] == older


@pytest.mark.django_db
def test_a_malformed_week_is_refused(auth_client, org):
    response = auth_client(org["hr"]).get(BY_EMPLOYEE, {"week": "last-tuesday"})
    assert response.status_code == 400
    assert "week" in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# The count behind the Submissions tab badge
# ---------------------------------------------------------------------------
# HR should see that something is outstanding without opening the tab to find
# out. The badge wants one integer, so the board can be asked for its totals
# without a row per employee.
@pytest.mark.django_db
def test_counts_only_leaves_out_the_rows(auth_client, org):
    response = auth_client(org["hr"]).get(
        "/api/v1/timesheets/status/by-employee/", {"counts_only": "true"}
    )

    assert response.status_code == 200
    assert "results" not in response.data
    assert "pending_count" in response.data
    assert "submitted_count" in response.data


@pytest.mark.django_db
def test_the_counts_are_the_same_either_way(auth_client, org):
    """Two shapes of one answer; they must not drift apart."""
    client = auth_client(org["hr"])
    full = client.get("/api/v1/timesheets/status/by-employee/")
    counts = client.get("/api/v1/timesheets/status/by-employee/", {"counts_only": "true"})

    assert counts.data["pending_count"] == full.data["pending_count"]
    assert counts.data["submitted_count"] == full.data["submitted_count"]
    assert counts.data["pending_count"] == sum(
        1 for row in full.data["results"] if not row["submitted"]
    )


@pytest.mark.django_db
def test_the_count_falls_when_somebody_submits(auth_client, org, team, past_week):
    """The badge is only useful if it tracks what it claims to count."""
    client = auth_client(org["hr"])
    url = "/api/v1/timesheets/status/by-employee/"

    before = client.get(url, {"counts_only": "true", "week": past_week.isoformat()})
    outstanding = before.data["pending_count"]
    assert outstanding > 0, "the fixture should leave somebody yet to submit"

    file_timesheet(org["employee"], team, past_week)

    after = client.get(url, {"counts_only": "true", "week": past_week.isoformat()})
    assert after.data["pending_count"] == outstanding - 1
    assert after.data["submitted_count"] == before.data["submitted_count"] + 1


@pytest.mark.django_db
def test_the_counts_still_need_view_all(auth_client, org):
    """The cheap shape must not be a way round who may see the board."""
    response = auth_client(org["employee"]).get(
        "/api/v1/timesheets/status/by-employee/", {"counts_only": "true"}
    )
    assert response.status_code == 403
