"""Telling people about their own staffing.

An employee has no reason to open the Projects page until they know they are on
something, so being put on a project has to reach them. Team membership and
allocation are separate records, made in separate dialogs and possibly days
apart, and each says something the other does not: the first is what they are
on and as what, the second how much of their time it takes - and that is what
opens it for timesheet booking. Allocation also needs no membership, so it can
be the only staffing someone gets. So each sends its own.

Nobody is told what they did themselves. Titles carry the project code, never
the name: both fields are 200 characters, so a name could overrun the title
and fail the assignment on a database that enforces the length.
"""

from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.projects.models import ProjectAllocation, ProjectMember
from common.humanize import human_date


def notify_added_to_team(member: ProjectMember, assigned_by) -> None:
    employee = member.employee
    if employee.user_id == assigned_by.pk:
        return

    project = member.project
    notify(
        employee.user,
        title=f"Assigned to project {project.code}",
        message=(
            f"{assigned_by.get_full_name()} added you to {project.name} ({project.code}) as "
            f"{member.get_role_in_project_display()}, from {human_date(member.joined_on)}."
        ),
        kind=Notification.Kind.PROJECT_ASSIGNED,
        link="/projects",
    )


def notify_allocated(allocation: ProjectAllocation, assigned_by) -> None:
    employee = allocation.employee
    if employee.user_id == assigned_by.pk:
        return

    project = allocation.project
    share = f"{allocation.allocation_percentage.normalize():f}"
    notify(
        employee.user,
        title=f"Allocated to project {project.code}",
        message=(
            f"{assigned_by.get_full_name()} allocated {share}% of your time to {project.name} "
            f"({project.code}), from {human_date(allocation.start_date)}. You can now book "
            "hours against it on your timesheet."
        ),
        kind=Notification.Kind.PROJECT_ASSIGNED,
        link="/timesheets",
    )
