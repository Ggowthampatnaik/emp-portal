"""Who may staff a project, and the 100% allocation rule.

These exist because of a bug found in end-to-end testing: the viewset gated
*every* write on `project.manage`, keyed off the HTTP verb. The team and
allocation routes are POSTs too, so `project.assign_team` and
`project.allocate` were unreachable - a manager could not put anybody on their
own project, and neither could HR. Both permissions were dead.
"""

from datetime import date
from decimal import Decimal

import pytest

from apps.projects.models import Project, ProjectAllocation, ProjectMember


def members_url(project) -> str:
    return f"/api/v1/projects/{project.pk}/members/"


def allocations_url(project) -> str:
    return f"/api/v1/projects/{project.pk}/allocations/"


# ---------------------------------------------------------------------------
# Staffing
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_manager_can_put_someone_on_a_project(auth_client, org, project):
    """The whole point of `project.assign_team` being on the Manager role."""
    response = auth_client(org["manager"]).post(
        members_url(project),
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )

    assert response.status_code == 201, response.data
    assert ProjectMember.objects.filter(project=project, employee=org["employee"]).exists()


@pytest.mark.django_db
def test_a_manager_can_allocate_their_time(auth_client, org, project):
    auth_client(org["manager"]).post(
        members_url(project),
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )
    response = auth_client(org["manager"]).post(
        allocations_url(project),
        {
            "employee": org["employee"].pk,
            "allocation_percentage": "60.00",
            "start_date": project.start_date.isoformat(),
        },
    )

    assert response.status_code == 201, response.data
    assert ProjectAllocation.objects.filter(project=project, employee=org["employee"]).exists()


@pytest.mark.django_db
def test_an_administrator_opens_projects_but_does_not_staff_them(auth_client, org, project):
    """The role matrix splits the two: Admin holds `project.manage`, the
    reporting manager holds `project.assign_team`. Recorded here so the split is
    a decision rather than an accident - an administrator who needs to staff a
    project can grant themselves the permission."""
    response = auth_client(org["admin"]).post(
        members_url(project),
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )
    assert response.status_code == 403, response.data


@pytest.mark.django_db
def test_an_employee_cannot(auth_client, org, project):
    response = auth_client(org["employee"]).post(
        members_url(project),
        {
            "employee": org["peer"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_creating_a_project_still_needs_project_manage(auth_client, org):
    """The narrower permissions must not have widened this one."""
    response = auth_client(org["manager"]).post(
        "/api/v1/projects/",
        {
            "code": "PRJ-NEW",
            "name": "Something New",
            "status": "active",
            "start_date": date.today().isoformat(),
        },
    )
    assert response.status_code == 403, "a manager staffs projects; it does not open them"


@pytest.mark.django_db
def test_someone_can_be_taken_off_a_project(auth_client, org, project):
    created = auth_client(org["manager"]).post(
        members_url(project),
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )
    member_id = created.data["id"]

    removed = auth_client(org["manager"]).delete(f"{members_url(project)}{member_id}/")

    assert removed.status_code == 204
    assert not ProjectMember.objects.filter(pk=member_id).exists()


# ---------------------------------------------------------------------------
# The 100% rule
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_nobody_can_be_allocated_past_a_hundred_percent(auth_client, org, project, department):
    other = Project.objects.create(
        code="PRJ-002",
        name="Second Project",
        department=department,
        status=Project.Status.ACTIVE,
        start_date=project.start_date,
    )
    client = auth_client(org["manager"])

    for target in (project, other):
        client.post(
            members_url(target),
            {
                "employee": org["employee"].pk,
                "role_in_project": "developer",
                "joined_on": target.start_date.isoformat(),
            },
        )

    first = client.post(
        allocations_url(project),
        {
            "employee": org["employee"].pk,
            "allocation_percentage": "70.00",
            "start_date": project.start_date.isoformat(),
        },
    )
    assert first.status_code == 201, first.data

    second = client.post(
        allocations_url(other),
        {
            "employee": org["employee"].pk,
            "allocation_percentage": "50.00",
            "start_date": other.start_date.isoformat(),
        },
    )
    assert second.status_code in (400, 409), "70% + 50% is more of a person than exists"

    total = sum(
        allocation.allocation_percentage
        for allocation in ProjectAllocation.objects.filter(employee=org["employee"])
    )
    assert total <= Decimal("100")


@pytest.mark.django_db
def test_the_team_list_is_readable_by_anyone_who_can_see_the_project(
    auth_client, org, allocated_project
):
    response = auth_client(org["employee"]).get(members_url(allocated_project))

    assert response.status_code == 200
    assert any(row["employee"] == org["employee"].pk for row in response.data)


@pytest.mark.django_db
def test_a_cancelled_project_keeps_its_history(auth_client, org, allocated_project):
    """Projects are cancelled rather than deleted - timesheets point at them."""
    response = auth_client(org["admin"]).delete(f"/api/v1/projects/{allocated_project.pk}/")

    assert response.status_code == 204
    allocated_project.refresh_from_db()
    assert allocated_project.status == Project.Status.CANCELLED
    assert Project.objects.filter(pk=allocated_project.pk).exists()
    assert ProjectMember.objects.filter(project=allocated_project).exists()


# ---------------------------------------------------------------------------
# HR reads the whole portfolio
# ---------------------------------------------------------------------------
# "Who is on what" is an HR question, but HR sits on no project team, so the
# scoped query used to return nothing at all - the Projects page was simply
# empty for them. `project.view_all` is a read grant; staffing and allocation
# stay with the reporting manager.
@pytest.mark.django_db
def test_hr_sees_every_project(auth_client, org, project, department):
    Project.objects.create(
        code="PRJ-HR2",
        name="Something HR Is Not On",
        department=department,
        status=Project.Status.ACTIVE,
        start_date=project.start_date,
    )

    response = auth_client(org["hr"]).get("/api/v1/projects/", {"page_size": 100})

    assert response.status_code == 200
    codes = {row["code"] for row in response.data["results"]}
    assert {"PRJ-001", "PRJ-HR2"} <= codes, f"HR should see the portfolio, got {codes}"


@pytest.mark.django_db
def test_hr_can_expand_a_project_they_are_not_on(auth_client, org, allocated_project):
    """Expanding a row fetches the project detail, which carries the team."""
    response = auth_client(org["hr"]).get(f"/api/v1/projects/{allocated_project.pk}/")

    assert response.status_code == 200, response.data
    assert any(
        member["employee"] == org["employee"].pk for member in response.data["members"]
    ), "the expanded row must show who is assigned"


@pytest.mark.django_db
def test_hr_still_cannot_staff_or_allocate(auth_client, org, project):
    """Read-only: the reporting manager still owns who goes on a project."""
    staffed = auth_client(org["hr"]).post(
        f"/api/v1/projects/{project.pk}/members/",
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
        },
    )
    assert staffed.status_code == 403

    allocated = auth_client(org["hr"]).post(
        f"/api/v1/projects/{project.pk}/allocations/",
        {
            "employee": org["employee"].pk,
            "allocation_percentage": "50.00",
            "start_date": project.start_date.isoformat(),
        },
    )
    assert allocated.status_code == 403


@pytest.mark.django_db
def test_hr_cannot_open_or_cancel_a_project(auth_client, org, project):
    from datetime import date

    opened = auth_client(org["hr"]).post(
        "/api/v1/projects/",
        {
            "code": "PRJ-HR9",
            "name": "Not HR's to open",
            "status": "active",
            "start_date": date.today().isoformat(),
        },
    )
    assert opened.status_code == 403
    assert auth_client(org["hr"]).delete(f"/api/v1/projects/{project.pk}/").status_code == 403


@pytest.mark.django_db
def test_an_ordinary_employee_still_sees_only_their_own(auth_client, org, project, department):
    """The grant is HR's, not everyone's."""
    Project.objects.create(
        code="PRJ-HR3",
        name="Nothing To Do With Them",
        department=department,
        status=Project.Status.ACTIVE,
        start_date=project.start_date,
    )

    response = auth_client(org["employee"]).get("/api/v1/projects/", {"page_size": 100})

    codes = {row["code"] for row in response.data["results"]}
    assert "PRJ-HR3" not in codes
