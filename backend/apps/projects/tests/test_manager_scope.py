"""A manager sees the projects they run or are on, not the whole company's."""

from datetime import date

import pytest

from apps.projects.models import Project, ProjectAllocation, ProjectMember


@pytest.fixture
def someone_elses(org, department):
    """Run by another manager, with nobody from this test's manager on it."""
    return Project.objects.create(
        code="PRJ-OTH",
        name="Someone Else's",
        department=department,
        project_manager=org["outsider"],
        status=Project.Status.ACTIVE,
        start_date=date(2026, 1, 5),
    )


@pytest.fixture
def their_own(org, department):
    return Project.objects.create(
        code="PRJ-OWN",
        name="Their Own",
        department=department,
        project_manager=org["manager"],
        status=Project.Status.ACTIVE,
        start_date=date(2026, 1, 5),
    )


def codes(client) -> set[str]:
    response = client.get("/api/v1/projects/", {"page_size": 100})
    assert response.status_code == 200, response.data
    return {row["code"] for row in response.data["results"]}


@pytest.mark.django_db
def test_a_manager_lists_only_the_projects_they_manage(auth_client, org, their_own, someone_elses):
    assert codes(auth_client(org["manager"])) == {"PRJ-OWN"}


@pytest.mark.django_db
def test_a_project_they_are_on_is_theirs_too(auth_client, org, someone_elses):
    ProjectMember.objects.create(
        project=someone_elses,
        employee=org["manager"],
        role_in_project="lead",
        joined_on=someone_elses.start_date,
    )

    assert codes(auth_client(org["manager"])) == {"PRJ-OTH"}


@pytest.mark.django_db
def test_a_manager_cannot_open_someone_elses_project(auth_client, org, someone_elses):
    response = auth_client(org["manager"]).get(f"/api/v1/projects/{someone_elses.pk}/")

    assert response.status_code == 404


@pytest.mark.django_db
def test_a_manager_cannot_staff_someone_elses_project(auth_client, org, someone_elses):
    response = auth_client(org["manager"]).post(
        f"/api/v1/projects/{someone_elses.pk}/members/",
        {
            "employee": org["employee"].pk,
            "role_in_project": "developer",
            "joined_on": someone_elses.start_date.isoformat(),
        },
    )

    assert response.status_code == 404
    assert not ProjectMember.objects.filter(project=someone_elses).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("person", ["hr", "admin"])
def test_hr_and_admin_still_see_every_project(auth_client, org, their_own, someone_elses, person):
    assert {"PRJ-OWN", "PRJ-OTH"} <= codes(auth_client(org[person]))


@pytest.mark.django_db
def test_the_project_report_keeps_to_the_same_projects(auth_client, org, their_own, someone_elses):
    response = auth_client(org["manager"]).get("/api/v1/reports/projects/")

    assert response.status_code == 200, response.data
    assert [row["code"] for row in response.data["results"]] == ["PRJ-OWN"]


@pytest.mark.django_db
def test_an_administrator_reports_on_every_project(auth_client, org, their_own, someone_elses):
    response = auth_client(org["admin"]).get("/api/v1/reports/projects/")

    assert {row["code"] for row in response.data["results"]} == {"PRJ-OWN", "PRJ-OTH"}


# ---------------------------------------------------------------------------
# Allocating keeps to the team
# ---------------------------------------------------------------------------
def allocate(client, project, employee):
    return client.post(
        f"/api/v1/projects/{project.pk}/allocations/",
        {
            "employee": employee.pk,
            "allocation_percentage": "50.00",
            "start_date": project.start_date.isoformat(),
        },
    )


@pytest.mark.django_db
def test_someone_off_the_team_cannot_be_allocated(auth_client, org, their_own):
    response = allocate(auth_client(org["manager"]), their_own, org["employee"])

    assert response.status_code == 400
    assert "team" in str(response.data)
    assert not ProjectAllocation.objects.exists()


@pytest.mark.django_db
def test_a_team_member_can_be_allocated(auth_client, org, their_own):
    ProjectMember.objects.create(
        project=their_own,
        employee=org["employee"],
        role_in_project="developer",
        joined_on=their_own.start_date,
    )

    response = allocate(auth_client(org["manager"]), their_own, org["employee"])

    assert response.status_code == 201, response.data


@pytest.mark.django_db
def test_someone_who_left_the_team_cannot_be_allocated(auth_client, org, their_own):
    ProjectMember.objects.create(
        project=their_own,
        employee=org["employee"],
        role_in_project="developer",
        joined_on=their_own.start_date,
        left_on=date(2026, 3, 1),
    )

    response = allocate(auth_client(org["manager"]), their_own, org["employee"])

    assert response.status_code == 400
