"""The company directory: readable by everyone, but narrow on purpose."""

import pytest

from common.enums import EmploymentStatus

URL = "/api/v1/employees/directory/"

# Anything personal must never appear in a list every employee can read.
PERSONAL_FIELDS = {
    "phone",
    "date_of_birth",
    "blood_group",
    "permanent_address",
    "current_address",
    "emergency_contact_name",
    "emergency_contact_phone",
}


@pytest.mark.django_db
def test_a_plain_employee_sees_the_whole_directory(auth_client, org):
    """Unlike /employees/, which scopes an employee to their own record."""
    response = auth_client(org["employee"]).get(URL)
    assert response.status_code == 200
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0002", "TRG0003", "TRG0004", "TRG0005", "TRG0006", "TRG0012"}


@pytest.mark.django_db
def test_the_scoped_list_is_still_restricted(auth_client, org):
    """Adding the directory must not have widened the full-record endpoint."""
    response = auth_client(org["employee"]).get("/api/v1/employees/")
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_the_directory_carries_no_personal_data(auth_client, org):
    response = auth_client(org["employee"]).get(URL)
    row = response.data["results"][0]
    assert PERSONAL_FIELDS.isdisjoint(row.keys())
    assert set(row) == {
        "id",
        "employee_code",
        "full_name",
        "email",
        "department_name",
        "designation_name",
        "reporting_manager",
        "reporting_manager_name",
        "direct_report_count",
        "date_of_joining",
        "work_location",
        "photo_url",
    }


@pytest.mark.django_db
def test_inactive_employees_are_left_out(auth_client, org):
    leaver = org["peer"]
    leaver.employment_status = EmploymentStatus.INACTIVE
    leaver.save(update_fields=["employment_status"])

    response = auth_client(org["employee"]).get(URL)
    codes = {row["employee_code"] for row in response.data["results"]}
    assert leaver.employee_code not in codes


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("term", "expected"),
    [
        ("Vikram", "TRG0004"),
        ("TRG0006", "TRG0006"),
        ("priya.menon", "TRG0002"),
        ("Software Engineer", "TRG0005"),
        ("Engineering", "TRG0005"),
    ],
)
def test_search_matches_name_id_email_designation_and_department(auth_client, org, term, expected):
    response = auth_client(org["employee"]).get(URL, {"search": term})
    codes = {row["employee_code"] for row in response.data["results"]}
    assert expected in codes, f"{term!r} did not match {expected}"


@pytest.mark.django_db
def test_search_with_no_match_returns_an_empty_page(auth_client, org):
    response = auth_client(org["employee"]).get(URL, {"search": "nobodyhere"})
    assert response.status_code == 200
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_the_directory_can_be_filtered_by_department(auth_client, org, department):
    response = auth_client(org["employee"]).get(URL, {"department": department.pk})
    assert response.status_code == 200
    assert all(row["department_name"] == department.name for row in response.data["results"])


@pytest.mark.django_db
def test_results_are_paginated(auth_client, org):
    response = auth_client(org["employee"]).get(URL, {"page_size": 2})
    assert len(response.data["results"]) == 2
    assert response.data["count"] == 6
    assert response.data["next"]


@pytest.mark.django_db
def test_anonymous_users_are_refused(api_client, org):
    assert api_client.get(URL).status_code == 401


# ---------------------------------------------------------------------------
# One directory entry, expanded
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_list_carries_every_field_the_detail_view_shows(auth_client, org):
    response = auth_client(org["employee"]).get(URL)
    row = next(r for r in response.data["results"] if r["employee_code"] == "TRG0004")

    assert row["date_of_joining"]
    assert row["direct_report_count"] == 2  # the manager's two reports
    assert row["reporting_manager"] is None or isinstance(row["reporting_manager"], int)


@pytest.mark.django_db
def test_a_single_entry_lists_the_direct_reports(auth_client, org):
    manager = org["manager"]
    response = auth_client(org["employee"]).get(f"{URL}{manager.pk}/")

    assert response.status_code == 200
    assert response.data["employee_code"] == "TRG0004"
    assert response.data["direct_report_count"] == 2

    reports = {row["employee_code"] for row in response.data["direct_reports"]}
    assert reports == {"TRG0005", "TRG0006"}
    assert all("full_name" in row and "photo_url" in row for row in response.data["direct_reports"])


@pytest.mark.django_db
def test_an_entry_without_reports_returns_an_empty_list(auth_client, org):
    response = auth_client(org["employee"]).get(f"{URL}{org['employee'].pk}/")
    assert response.status_code == 200
    assert response.data["direct_reports"] == []
    assert response.data["direct_report_count"] == 0


@pytest.mark.django_db
def test_the_expanded_entry_still_hides_personal_data(auth_client, org):
    response = auth_client(org["employee"]).get(f"{URL}{org['manager'].pk}/")
    assert PERSONAL_FIELDS.isdisjoint(response.data.keys())


@pytest.mark.django_db
def test_inactive_reports_are_left_out_of_the_list(auth_client, org):
    leaver = org["peer"]
    leaver.employment_status = EmploymentStatus.INACTIVE
    leaver.save(update_fields=["employment_status"])

    response = auth_client(org["employee"]).get(f"{URL}{org['manager'].pk}/")
    reports = {row["employee_code"] for row in response.data["direct_reports"]}
    assert reports == {"TRG0005"}


@pytest.mark.django_db
def test_an_unknown_or_inactive_employee_is_a_404(auth_client, org):
    assert auth_client(org["employee"]).get(f"{URL}999999/").status_code == 404

    org["outsider"].employment_status = EmploymentStatus.INACTIVE
    org["outsider"].save(update_fields=["employment_status"])
    assert auth_client(org["employee"]).get(f"{URL}{org['outsider'].pk}/").status_code == 404


@pytest.mark.django_db
def test_the_expanded_entry_needs_authentication(api_client, org):
    assert api_client.get(f"{URL}{org['manager'].pk}/").status_code == 401
