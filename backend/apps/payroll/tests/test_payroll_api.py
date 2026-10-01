"""Finding a salary structure.

The list is one row per person and grows with headcount, so it needs a search
box. What it searches *on* is the part worth pinning: it was employee code and
first name only, so typing a surname - the obvious thing to type - found
nothing at all.
"""

import pytest


def structures(client, **params):
    return client.get("/api/v1/salary-structures/", {"page_size": 100, **params})


@pytest.mark.django_db
def test_a_structure_is_found_by_employee_code(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search=org["employee"].employee_code)

    assert response.status_code == 200
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_a_structure_is_found_by_first_name(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search=org["employee"].user.first_name)
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_a_structure_is_found_by_surname(auth_client, org, structure):
    """The one that used to fail: a surname is what people type."""
    response = structures(auth_client(org["hr"]), search=org["employee"].user.last_name)
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_a_structure_is_found_by_email(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search=org["employee"].user.email)
    assert response.data["count"] == 1


@pytest.mark.django_db
def test_a_structure_is_found_by_department(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search=org["employee"].department.name)
    assert response.data["count"] >= 1


@pytest.mark.django_db
def test_a_structure_is_found_by_designation(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search=org["employee"].designation.name)
    assert response.data["count"] >= 1


@pytest.mark.django_db
def test_a_search_matching_nobody_is_empty_not_an_error(auth_client, org, structure):
    response = structures(auth_client(org["hr"]), search="zzzznotaperson")

    assert response.status_code == 200
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_the_search_narrows_to_the_person_asked_for(auth_client, org, structure):
    """With two structures on file, a search must return one of them."""
    from datetime import date
    from decimal import Decimal

    from apps.payroll.models import SalaryStructure

    SalaryStructure.objects.create(
        employee=org["peer"],
        effective_from=date(2024, 1, 1),
        basic=Decimal("30000"),
        hra=Decimal("15000"),
    )

    everyone = structures(auth_client(org["hr"]))
    assert everyone.data["count"] == 2

    narrowed = structures(auth_client(org["hr"]), search=org["peer"].employee_code)
    assert narrowed.data["count"] == 1
    assert narrowed.data["results"][0]["employee_code"] == org["peer"].employee_code


@pytest.mark.django_db
def test_search_and_the_current_filter_narrow_together(auth_client, org, structure):
    """Two filters, not one replacing the other."""
    response = structures(
        auth_client(org["hr"]), search=org["employee"].user.last_name, current="true"
    )

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert all(row["effective_to"] is None for row in response.data["results"])


@pytest.mark.django_db
def test_searching_still_needs_payroll_manage(auth_client, org, structure):
    """The search box must not be a way around who may see pay."""
    response = structures(auth_client(org["employee"]), search=org["employee"].user.last_name)
    assert response.status_code == 403
