"""Being put on a project reaches the person it happened to.

The `project_assigned` notification kind existed from the start, but nothing
ever sent it: a manager could staff someone and they would only find out by
opening the Projects page or being told. Allocation is covered as well as team
membership because it needs no membership, and it is what opens the project
for timesheet booking.
"""

import pytest
from django.core import mail

from apps.notifications.models import Notification
from apps.projects.models import Project, ProjectMember


def add_to_team(client, project, employee, **overrides):
    return client.post(
        f"/api/v1/projects/{project.pk}/members/",
        {
            "employee": employee.pk,
            "role_in_project": "developer",
            "joined_on": project.start_date.isoformat(),
            **overrides,
        },
    )


def allocate(client, project, employee, percentage="60.00"):
    """Allocates someone already on the team, which is the only way now."""
    ProjectMember.objects.get_or_create(
        project=project,
        employee=employee,
        left_on=None,
        defaults={"role_in_project": "developer", "joined_on": project.start_date},
    )
    return client.post(
        f"/api/v1/projects/{project.pk}/allocations/",
        {
            "employee": employee.pk,
            "allocation_percentage": percentage,
            "start_date": project.start_date.isoformat(),
        },
    )


def notes_for(employee):
    return Notification.objects.filter(recipient=employee.user)


@pytest.mark.django_db
def test_joining_a_team_notifies_the_employee(auth_client, org, project):
    response = add_to_team(
        auth_client(org["manager"]), project, org["employee"], role_in_project="qa"
    )

    assert response.status_code == 201, response.data
    note = notes_for(org["employee"]).get()
    assert note.kind == Notification.Kind.PROJECT_ASSIGNED
    assert note.title == f"Assigned to project {project.code}"
    assert org["manager"].user.get_full_name() in note.message
    assert project.name in note.message
    assert "as QA" in note.message
    assert note.link == "/projects"


@pytest.mark.django_db
def test_being_allocated_notifies_the_employee(auth_client, org, project):
    response = allocate(auth_client(org["manager"]), project, org["employee"], "62.50")

    assert response.status_code == 201, response.data
    note = notes_for(org["employee"]).get()
    assert note.kind == Notification.Kind.PROJECT_ASSIGNED
    assert note.title == f"Allocated to project {project.code}"
    assert "62.5% of your time" in note.message
    assert note.link == "/timesheets"


@pytest.mark.django_db
def test_a_round_percentage_reads_as_a_whole_number(auth_client, org, project):
    allocate(auth_client(org["manager"]), project, org["employee"], "100.00")

    assert "100% of your time" in notes_for(org["employee"]).get().message


@pytest.mark.django_db
def test_the_notification_is_emailed_as_well(auth_client, org, project):
    add_to_team(auth_client(org["manager"]), project, org["employee"])

    assert [message.to for message in mail.outbox] == [[org["employee"].user.email]]
    assert project.code in mail.outbox[0].subject


@pytest.mark.django_db
def test_it_shows_in_the_employees_own_list(auth_client, org, project):
    add_to_team(auth_client(org["manager"]), project, org["employee"])

    client = auth_client(org["employee"])
    assert client.get("/api/v1/notifications/unread-count/").data["unread"] == 1
    titles = [row["title"] for row in client.get("/api/v1/notifications/").data["results"]]
    assert titles == [f"Assigned to project {project.code}"]


@pytest.mark.django_db
def test_only_the_person_assigned_hears_about_it(auth_client, org, project):
    add_to_team(auth_client(org["manager"]), project, org["employee"])

    assert Notification.objects.exclude(recipient=org["employee"].user).count() == 0


@pytest.mark.django_db
def test_a_manager_is_not_told_what_they_did_themselves(auth_client, org, project):
    client = auth_client(org["manager"])

    assert add_to_team(client, project, org["manager"]).status_code == 201
    assert allocate(client, project, org["manager"]).status_code == 201

    assert not notes_for(org["manager"]).exists()
    assert mail.outbox == []


@pytest.mark.django_db
def test_a_refused_assignment_says_nothing(auth_client, org, project):
    """Already on the team: the second attempt is rejected, so no second note."""
    client = auth_client(org["manager"])
    add_to_team(client, project, org["employee"])

    assert add_to_team(client, project, org["employee"]).status_code == 400

    assert notes_for(org["employee"]).count() == 1


@pytest.mark.django_db
def test_an_allocation_past_a_hundred_percent_says_nothing(auth_client, org, project):
    response = allocate(auth_client(org["manager"]), project, org["employee"], "150.00")

    assert response.status_code == 400
    assert not notes_for(org["employee"]).exists()


@pytest.mark.django_db
def test_someone_without_the_permission_triggers_nothing(auth_client, org, project):
    assert add_to_team(auth_client(org["hr"]), project, org["employee"]).status_code == 403

    assert not notes_for(org["employee"]).exists()


@pytest.mark.django_db
def test_changing_a_role_is_not_a_new_assignment(auth_client, org, project):
    client = auth_client(org["manager"])
    member_id = add_to_team(client, project, org["employee"]).data["id"]

    changed = client.patch(
        f"/api/v1/projects/{project.pk}/members/{member_id}/", {"role_in_project": "lead"}
    )

    assert changed.status_code == 200, changed.data
    assert notes_for(org["employee"]).count() == 1


@pytest.mark.django_db
def test_being_taken_off_and_put_back_is_a_new_assignment(auth_client, org, project):
    client = auth_client(org["manager"])
    member_id = add_to_team(client, project, org["employee"]).data["id"]
    client.delete(f"/api/v1/projects/{project.pk}/members/{member_id}/")

    add_to_team(client, project, org["employee"])

    assert notes_for(org["employee"]).count() == 2


@pytest.mark.django_db
def test_the_longest_project_name_still_fits(auth_client, org, department):
    """The title has the same limit as the name, so it must not carry the name."""
    project = Project.objects.create(
        code="PRJ-LONG",
        name="N" * 200,
        department=department,
        project_manager=org["manager"],
        status=Project.Status.ACTIVE,
        start_date="2026-01-01",
    )
    project.refresh_from_db()

    add_to_team(auth_client(org["manager"]), project, org["employee"])

    note = notes_for(org["employee"]).get()
    assert len(note.title) <= Notification._meta.get_field("title").max_length
    assert project.name in note.message
