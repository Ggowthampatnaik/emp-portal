"""HR assigns reporting lines: a manager's whole list of direct reports at once.

The org fixture: Vikram (manager) has Asha and Karthik reporting to him; Priya
(HR), Rahul (admin) and Rohan have no manager.
"""

import pytest

from apps.administration.models import AuditLog
from apps.employees.models import Employee


def url(employee) -> str:
    return f"/api/v1/employees/{employee.pk}/direct-reports/"


def reports_of(employee) -> set[str]:
    return set(
        Employee.objects.filter(reporting_manager=employee).values_list("employee_code", flat=True)
    )


@pytest.mark.django_db
def test_anyone_who_can_see_the_record_can_see_who_reports_to_them(auth_client, org):
    response = auth_client(org["hr"]).get(url(org["manager"]))

    assert response.status_code == 200
    assert {row["employee_code"] for row in response.data} == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_hr_sets_the_whole_list_and_those_dropped_lose_their_manager(auth_client, org):
    body = {"employee_ids": [org["employee"].pk, org["outsider"].pk]}

    response = auth_client(org["hr"]).put(url(org["manager"]), body, format="json")

    assert response.status_code == 200, response.data
    assert reports_of(org["manager"]) == {"TRG0005", "TRG0012"}
    org["peer"].refresh_from_db()
    assert org["peer"].reporting_manager is None  # Karthik was dropped


@pytest.mark.django_db
def test_moving_someone_takes_them_from_their_old_manager(auth_client, org):
    response = auth_client(org["hr"]).put(
        url(org["admin"]), {"employee_ids": [org["employee"].pk]}, format="json"
    )

    assert response.status_code == 200, response.data
    org["employee"].refresh_from_db()
    assert org["employee"].reporting_manager_id == org["admin"].pk
    assert reports_of(org["manager"]) == {"TRG0006"}


@pytest.mark.django_db
def test_an_empty_list_clears_everyone(auth_client, org):
    response = auth_client(org["hr"]).put(url(org["manager"]), {"employee_ids": []}, format="json")

    assert response.status_code == 200
    assert reports_of(org["manager"]) == set()


@pytest.mark.django_db
def test_nobody_reports_to_themselves(auth_client, org):
    response = auth_client(org["hr"]).put(
        url(org["manager"]), {"employee_ids": [org["manager"].pk]}, format="json"
    )

    assert response.status_code == 400
    assert "cannot report to themselves" in str(response.data)


@pytest.mark.django_db
def test_a_reporting_loop_is_refused(auth_client, org):
    # Asha reports to Vikram, so Vikram cannot also report to Asha.
    response = auth_client(org["hr"]).put(
        url(org["employee"]), {"employee_ids": [org["manager"].pk]}, format="json"
    )

    assert response.status_code == 400
    assert "above" in str(response.data)
    org["manager"].refresh_from_db()
    assert org["manager"].reporting_manager is None


@pytest.mark.django_db
def test_an_unknown_employee_is_refused_and_nothing_changes(auth_client, org):
    response = auth_client(org["hr"]).put(
        url(org["manager"]), {"employee_ids": [org["outsider"].pk, 999999]}, format="json"
    )

    assert response.status_code == 400
    assert reports_of(org["manager"]) == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
@pytest.mark.parametrize("who", ["manager", "employee"])
def test_only_hr_and_admins_assign_reporting_lines(auth_client, org, who):
    response = auth_client(org[who]).put(url(org["manager"]), {"employee_ids": []}, format="json")

    assert response.status_code == 403
    assert reports_of(org["manager"]) == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_an_admin_may_too(auth_client, org):
    response = auth_client(org["admin"]).put(
        url(org["manager"]), {"employee_ids": [org["employee"].pk]}, format="json"
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_every_change_is_in_the_audit_trail(auth_client, org):
    auth_client(org["hr"]).put(
        url(org["manager"]), {"employee_ids": [org["employee"].pk]}, format="json"
    )

    rows = AuditLog.objects.filter(changes__has_key="reporting_manager")
    assert rows.count() == 1  # Karthik dropped; Asha was already there


@pytest.mark.django_db
def test_hr_can_change_one_persons_manager_from_their_record(auth_client, org):
    response = auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['peer'].pk}/",
        {"reporting_manager": org["admin"].pk},
        format="json",
    )

    assert response.status_code == 200, response.data
    org["peer"].refresh_from_db()
    assert org["peer"].reporting_manager_id == org["admin"].pk
