"""Timesheet workflow: entry rules, the state machine, and who may decide."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.projects.models import Project, ProjectAllocation
from apps.timesheets.services import (
    approve_timesheet,
    get_or_create_timesheet,
    reject_timesheet,
    save_entries,
    submit_timesheet,
    week_start,
)
from common.enums import ApprovalStatus
from common.exceptions import BusinessRuleViolation, WorkflowStateError


def rows(project, monday, *hours_by_day) -> list[dict]:
    """Grid rows. Descriptions are filled: submission now requires them."""
    return [
        {
            "project": project,
            "work_date": monday + timedelta(days=index),
            "hours": Decimal(str(hours)),
            "description": "Sprint work",
        }
        for index, hours in enumerate(hours_by_day)
    ]


# ---------------------------------------------------------------------------
# Week handling
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_week_start_is_always_monday(past_monday):
    for offset in range(7):
        assert week_start(past_monday + timedelta(days=offset)) == past_monday


@pytest.mark.django_db
def test_the_sheet_is_created_on_first_access(org, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday + timedelta(days=3))
    assert sheet.week_start_date == past_monday
    assert sheet.status == ApprovalStatus.DRAFT
    assert sheet.week_end_date == past_monday + timedelta(days=6)

    again = get_or_create_timesheet(org["employee"], past_monday)
    assert again.pk == sheet.pk  # one sheet per employee per week


# ---------------------------------------------------------------------------
# Entry rules
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_saving_entries_recalculates_the_total(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8, 8, 6.5))

    sheet.refresh_from_db()
    assert sheet.entries.count() == 3
    assert sheet.total_hours == Decimal("22.50")


@pytest.mark.django_db
def test_saving_replaces_the_previous_entries(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8, 8))
    save_entries(sheet, rows(allocated_project, past_monday, 4))

    sheet.refresh_from_db()
    assert sheet.entries.count() == 1
    assert sheet.total_hours == Decimal("4.00")


@pytest.mark.django_db
def test_zero_hour_cells_are_dropped(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8, 0, 0, 7))
    assert sheet.entries.count() == 2


@pytest.mark.django_db
def test_a_date_outside_the_week_is_refused(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    with pytest.raises(BusinessRuleViolation, match="outside the week"):
        save_entries(
            sheet,
            [
                {
                    "project": allocated_project,
                    "work_date": past_monday + timedelta(days=9),
                    "hours": Decimal("8"),
                }
            ],
        )


@pytest.mark.django_db
def test_more_than_24_hours_in_a_day_is_refused(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    second = Project.objects.create(
        code="PRJ-002", name="Second", status=Project.Status.ACTIVE, start_date=past_monday
    )
    ProjectAllocation.objects.create(
        project=second,
        employee=org["employee"],
        allocation_percentage=Decimal("40"),
        start_date=past_monday,
    )

    with pytest.raises(BusinessRuleViolation, match="maximum is 24"):
        save_entries(
            sheet,
            [
                {"project": allocated_project, "work_date": past_monday, "hours": Decimal("14")},
                {"project": second, "work_date": past_monday, "hours": Decimal("12")},
            ],
        )


@pytest.mark.django_db
def test_hours_can_only_go_to_an_allocated_project(org, allocated_project, past_monday):
    """The employee is allocated to allocated_project, but not to this one."""
    other = Project.objects.create(
        code="PRJ-099", name="Unallocated", status=Project.Status.ACTIVE, start_date=past_monday
    )
    sheet = get_or_create_timesheet(org["employee"], past_monday)

    with pytest.raises(BusinessRuleViolation, match="allocated to"):
        save_entries(sheet, [{"project": other, "work_date": past_monday, "hours": Decimal("8")}])


@pytest.mark.django_db
def test_an_approved_sheet_cannot_be_edited(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8))
    submit_timesheet(sheet.pk, org["employee"].user)
    approve_timesheet(sheet.pk, org["manager"].user)

    sheet.refresh_from_db()
    with pytest.raises(WorkflowStateError, match="cannot be edited"):
        save_entries(sheet, rows(allocated_project, past_monday, 4))


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_empty_sheet_cannot_be_submitted(org, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    with pytest.raises(BusinessRuleViolation, match="at least one entry"):
        submit_timesheet(sheet.pk, org["employee"].user)


@pytest.mark.django_db
def test_submit_then_approve_locks_the_sheet(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8, 8))

    submitted = submit_timesheet(sheet.pk, org["employee"].user, "Week done.")
    assert submitted.status == ApprovalStatus.PENDING
    assert submitted.submitted_at is not None
    assert submitted.is_editable is False

    approved = approve_timesheet(sheet.pk, org["manager"].user, "Looks right.")
    assert approved.status == ApprovalStatus.APPROVED
    assert approved.is_locked is True


@pytest.mark.django_db
def test_rejection_makes_the_sheet_editable_again(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8))
    submit_timesheet(sheet.pk, org["employee"].user)

    rejected = reject_timesheet(sheet.pk, org["manager"].user, "Split the Friday hours.")
    assert rejected.status == ApprovalStatus.REJECTED
    assert rejected.is_editable is True

    save_entries(rejected, rows(allocated_project, past_monday, 6, 2))
    assert rejected.entries.count() == 2


@pytest.mark.django_db
def test_a_rejection_must_carry_a_reason(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8))
    submit_timesheet(sheet.pk, org["employee"].user)

    with pytest.raises(BusinessRuleViolation, match="explain"):
        reject_timesheet(sheet.pk, org["manager"].user, "")


@pytest.mark.django_db
def test_a_draft_cannot_be_approved(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8))
    with pytest.raises(WorkflowStateError, match="Only submitted"):
        approve_timesheet(sheet.pk, org["manager"].user)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_weekly_endpoint_creates_and_returns_the_grid(auth_client, org, past_monday):
    response = auth_client(org["employee"]).get(
        f"/api/v1/timesheets/weekly/?date={past_monday.isoformat()}"
    )
    assert response.status_code == 200
    assert response.data["week_start_date"] == past_monday.isoformat()
    assert response.data["status"] == ApprovalStatus.DRAFT
    assert response.data["entries"] == []


@pytest.mark.django_db
def test_saving_the_grid_through_the_api(auth_client, org, allocated_project, past_monday):
    client = auth_client(org["employee"])
    sheet = get_or_create_timesheet(org["employee"], past_monday)

    response = client.put(
        f"/api/v1/timesheets/{sheet.pk}/entries/",
        {
            "entries": [
                {
                    "project": allocated_project.pk,
                    "work_date": past_monday.isoformat(),
                    "hours": "8.00",
                    "description": "Sprint work",
                }
            ]
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["total_hours"] == "8.00"


@pytest.mark.django_db
def test_an_employee_cannot_edit_someone_elses_sheet(auth_client, org, past_monday):
    other = get_or_create_timesheet(org["peer"], past_monday)
    response = auth_client(org["employee"]).put(
        f"/api/v1/timesheets/{other.pk}/entries/", {"entries": []}
    )
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_a_manager_cannot_approve_their_own_sheet(auth_client, org, project, past_monday):
    ProjectAllocation.objects.create(
        project=project,
        employee=org["manager"],
        allocation_percentage=Decimal("50"),
        start_date=past_monday,
    )
    sheet = get_or_create_timesheet(org["manager"], past_monday)
    save_entries(sheet, rows(project, past_monday, 8))
    submit_timesheet(sheet.pk, org["manager"].user)

    response = auth_client(org["manager"]).post(f"/api/v1/timesheets/{sheet.pk}/approve/", {})
    assert response.status_code == 403
    assert "your own" in response.data["error"]["message"]


@pytest.mark.django_db
def test_the_approval_queue_shows_only_the_managers_branch(
    auth_client, org, allocated_project, past_monday
):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(sheet, rows(allocated_project, past_monday, 8))
    submit_timesheet(sheet.pk, org["employee"].user)

    # An unrelated employee's submitted sheet must not appear.
    outsider_project = Project.objects.create(
        code="PRJ-777", name="Other", status=Project.Status.ACTIVE, start_date=past_monday
    )
    ProjectAllocation.objects.create(
        project=outsider_project,
        employee=org["outsider"],
        allocation_percentage=Decimal("50"),
        start_date=past_monday,
    )
    outsider_sheet = get_or_create_timesheet(org["outsider"], past_monday)
    save_entries(outsider_sheet, rows(outsider_project, past_monday, 8))
    submit_timesheet(outsider_sheet.pk, org["outsider"].user)

    response = auth_client(org["manager"]).get("/api/v1/timesheets/pending-approvals/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0005"}


@pytest.mark.django_db
def test_current_week_summary_powers_the_dashboard_card(auth_client, org, allocated_project):
    # Derived from today rather than a fixture: this endpoint answers for the
    # week you are actually in, and Monday is never in the future.
    monday = week_start(timezone.localdate())
    sheet = get_or_create_timesheet(org["employee"], monday)
    save_entries(
        sheet, [{"project": allocated_project, "work_date": monday, "hours": Decimal("7")}]
    )

    response = auth_client(org["employee"]).get("/api/v1/timesheets/current-week-summary/")
    assert response.status_code == 200
    assert response.data["hours"] == "7.00"
    assert response.data["status"] == ApprovalStatus.DRAFT


# ---------------------------------------------------------------------------
# Phase 2 / F5: a task description is required before submitting
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_submitting_without_a_description_is_refused(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(
        sheet,
        [{"project": allocated_project, "work_date": past_monday, "hours": Decimal("8")}],
    )

    with pytest.raises(BusinessRuleViolation, match="task description"):
        submit_timesheet(sheet.pk, org["employee"].user)


@pytest.mark.django_db
def test_the_refusal_names_the_offending_entry(org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(
        sheet,
        [
            {
                "project": allocated_project,
                "work_date": past_monday,
                "hours": Decimal("8"),
                "description": "Written up",
            },
            {
                "project": allocated_project,
                "work_date": past_monday + timedelta(days=1),
                "hours": Decimal("8"),
            },
        ],
    )

    with pytest.raises(BusinessRuleViolation) as caught:
        submit_timesheet(sheet.pk, org["employee"].user)

    message = str(caught.value)
    assert allocated_project.code in message
    assert "1 missing" in message


@pytest.mark.django_db
def test_descriptions_survive_the_round_trip(auth_client, org, allocated_project, past_monday):
    client = auth_client(org["employee"])
    sheet = get_or_create_timesheet(org["employee"], past_monday)

    response = client.put(
        f"/api/v1/timesheets/{sheet.pk}/entries/",
        {
            "entries": [
                {
                    "project": allocated_project.pk,
                    "work_date": past_monday.isoformat(),
                    "hours": "8.00",
                    "description": "Rewrote the allocation validator",
                }
            ]
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["entries"][0]["description"] == "Rewrote the allocation validator"

    submitted = client.post(f"/api/v1/timesheets/{sheet.pk}/submit/", {})
    assert submitted.status_code == 200
    assert submitted.data["entries"][0]["description"] == "Rewrote the allocation validator"


@pytest.mark.django_db
def test_the_manager_sees_the_task_description(auth_client, org, allocated_project, past_monday):
    sheet = get_or_create_timesheet(org["employee"], past_monday)
    save_entries(
        sheet,
        [
            {
                "project": allocated_project,
                "work_date": past_monday,
                "hours": Decimal("8"),
                "description": "Paired on the payroll rounding bug",
            }
        ],
    )
    submit_timesheet(sheet.pk, org["employee"].user)

    response = auth_client(org["manager"]).get(f"/api/v1/timesheets/{sheet.pk}/")
    assert response.status_code == 200
    assert response.data["entries"][0]["description"] == "Paired on the payroll rounding bug"


@pytest.mark.django_db
def test_hr_picks_the_sheet_up_once_the_manager_has_approved(
    auth_client, org, allocated_project, past_monday
):
    """The manager's approval is the handoff; HR needs no separate share step."""
    sheet = get_or_create_timesheet(org["employee"], past_monday)
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
    submit_timesheet(sheet.pk, org["employee"].user)
    approve_timesheet(sheet.pk, org["manager"].user)

    hr = auth_client(org["hr"])
    listing = hr.get("/api/v1/timesheets/", {"status": "approved"})
    assert listing.status_code == 200
    assert sheet.pk in [row["id"] for row in listing.data["results"]]

    detail = hr.get(f"/api/v1/timesheets/{sheet.pk}/")
    assert detail.status_code == 200
    assert detail.data["decided_by_name"] == org["manager"].full_name
    assert detail.data["entries"][0]["description"] == "Sprint work"

    # And it is HR's `timesheet.view_all` doing the work, not approval making the
    # sheet public - a colleague on the same team still cannot see it.
    assert auth_client(org["peer"]).get(f"/api/v1/timesheets/{sheet.pk}/").status_code == 404


# ---------------------------------------------------------------------------
# Nothing is booked before it happens
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hours_cannot_be_booked_for_a_day_that_has_not_happened(org, allocated_project):
    """Hours report work already done, so a future day has nothing to report.
    A whole future week was being filled in and submitted."""
    today = timezone.localdate()
    sheet = get_or_create_timesheet(org["employee"], today)
    tomorrow = today + timedelta(days=1)

    with pytest.raises(BusinessRuleViolation, match="has not happened yet"):
        save_entries(
            sheet,
            [
                {
                    "project": allocated_project,
                    "work_date": tomorrow,
                    "hours": Decimal("8"),
                    "description": "Sprint work",
                }
            ],
        )


@pytest.mark.django_db
def test_today_is_still_bookable(org, allocated_project):
    today = timezone.localdate()
    sheet = get_or_create_timesheet(org["employee"], today)

    save_entries(
        sheet,
        [
            {
                "project": allocated_project,
                "work_date": today,
                "hours": Decimal("8"),
                "description": "Sprint work",
            }
        ],
    )

    assert sheet.entries.count() == 1
    assert sheet.entries.first().work_date == today


@pytest.mark.django_db
def test_a_whole_week_in_the_past_is_bookable(org, allocated_project, past_monday):
    """The ordinary case: filling last week's sheet, every day of it behind us."""
    sheet = get_or_create_timesheet(org["employee"], past_monday)

    save_entries(sheet, rows(allocated_project, past_monday, 8, 8, 8, 8, 8))

    assert sheet.entries.count() == 5
