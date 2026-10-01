"""Every report must render, be permission-gated, and respect visibility scope."""

from datetime import timedelta
from decimal import Decimal

import pytest

from apps.leave_management.services import apply_for_leave
from apps.timesheets.services import get_or_create_timesheet, save_entries, submit_timesheet

REPORTS = [
    "/api/v1/reports/employees/",
    "/api/v1/reports/leave/",
    "/api/v1/reports/timesheet/",
    "/api/v1/reports/projects/",
]


@pytest.fixture
def with_activity(org, leave_type, allocated_project, next_monday, past_monday, approve_leave):
    """A little real data so the reports have rows to aggregate."""
    request = apply_for_leave(
        org["employee"], leave_type, next_monday, next_monday, "Report fixture."
    )
    approve_leave(request.pk, org["manager"].user)

    # Leave is applied for ahead of time; hours report work already done, so
    # the two halves of this fixture sit in different weeks.
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(
        sheet,
        [
            {
                "project": allocated_project,
                "work_date": past_monday,
                "hours": Decimal("8"),
                "description": "Sprint work",
            },
            {
                "project": allocated_project,
                "work_date": past_monday + timedelta(days=1),
                "hours": Decimal("6.5"),
                "description": "Sprint work",
            },
        ],
    )
    submit_timesheet(sheet.pk, org["employee"].user)
    return org


@pytest.mark.django_db
@pytest.mark.parametrize("url", REPORTS)
def test_every_report_renders_for_an_admin(auth_client, with_activity, url):
    """Admin holds all four report permissions; HR deliberately lacks report.project."""
    response = auth_client(with_activity["admin"]).get(url)
    assert response.status_code == 200, response.data
    assert "results" in response.data


@pytest.mark.django_db
def test_timesheet_report_totals_the_booked_hours(auth_client, with_activity):
    response = auth_client(with_activity["hr"]).get("/api/v1/reports/timesheet/?from=2000-01-01")
    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["employee_code"] == "TRG0005")
    assert Decimal(row["hours"]) == Decimal("14.5")
    assert Decimal(row["billable_hours"]) == Decimal("14.5")
    assert Decimal(response.data["total_hours"]) == Decimal("14.5")


@pytest.mark.django_db
def test_leave_report_splits_approved_and_pending(
    auth_client, with_activity, leave_type, next_monday
):
    apply_for_leave(
        with_activity["peer"],
        leave_type,
        next_monday + timedelta(days=14),
        next_monday + timedelta(days=14),
        "Still pending.",
    )
    response = auth_client(with_activity["hr"]).get("/api/v1/reports/leave/")
    rows = {row["employee_code"]: row for row in response.data["results"]}
    assert Decimal(rows["TRG0005"]["approved_days"]) == Decimal("1")
    assert Decimal(rows["TRG0006"]["pending_days"]) == Decimal("1")


@pytest.mark.django_db
def test_headcount_report_groups_by_department(auth_client, with_activity):
    """Managers must not be double-counted by the direct_reports join."""
    response = auth_client(with_activity["hr"]).get("/api/v1/reports/employees/")
    assert response.data["total_headcount"] == 6
    engineering = next(
        row for row in response.data["results"] if row["department"] == "Engineering"
    )
    assert engineering["headcount"] == 6
    assert engineering["active"] == 6


@pytest.mark.django_db
def test_an_employee_cannot_open_reports(auth_client, with_activity):
    for url in REPORTS:
        response = auth_client(with_activity["employee"]).get(url)
        assert response.status_code == 403, url


@pytest.mark.django_db
def test_a_manager_report_covers_only_their_branch(
    auth_client, with_activity, leave_type, next_monday
):
    """The outsider's leave must not appear in the manager's report."""
    apply_for_leave(
        with_activity["outsider"],
        leave_type,
        next_monday + timedelta(days=21),
        next_monday + timedelta(days=21),
        "Unrelated.",
    )
    response = auth_client(with_activity["manager"]).get("/api/v1/reports/leave/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert "TRG0012" not in codes
    assert "TRG0005" in codes


@pytest.mark.django_db
def test_csv_export_returns_a_file(auth_client, with_activity):
    response = auth_client(with_activity["hr"]).get("/api/v1/reports/leave/?export=csv")
    assert response.status_code == 200
    assert response["Content-Type"] == "text/csv"
    assert "attachment; filename=" in response["Content-Disposition"]
    body = response.content.decode()
    assert body.splitlines()[0].startswith("employee_code,employee,department")


@pytest.mark.django_db
def test_export_needs_the_export_permission(auth_client, with_activity):
    """The manager role carries report.export; strip it and the export is refused."""
    manager_user = with_activity["manager"].user
    role = manager_user.roles.get(slug="manager")
    role.permissions.remove(role.permissions.get(code="report.export"))
    manager_user._permission_cache = None

    response = auth_client(with_activity["manager"]).get("/api/v1/reports/leave/?export=csv")
    assert response.status_code == 403


@pytest.mark.django_db
def test_dashboard_summary_is_role_aware(auth_client, with_activity):
    employee = auth_client(with_activity["employee"]).get("/api/v1/dashboard/summary/")
    assert employee.status_code == 200
    assert "me" in employee.data
    assert "approvals" not in employee.data
    assert "organization" not in employee.data

    manager = auth_client(with_activity["manager"]).get("/api/v1/dashboard/summary/")
    assert "approvals" in manager.data
    assert manager.data["approvals"]["pending_timesheets"] == 1

    hr = auth_client(with_activity["hr"]).get("/api/v1/dashboard/summary/")
    assert "organization" in hr.data
    assert hr.data["organization"]["headcount"] == 6
