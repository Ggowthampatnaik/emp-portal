"""Company holidays, and the description that is now required.

A holiday with no description reaches employees as a bare date and a name on
the calendar and the dashboard card, which is where the question "what is this
one?" gets asked. So HR is made to answer it once, at the point of writing.

The rule lives on the serializer rather than the model on purpose. Holidays
already on file predate it and several carry no description; a non-blank column
would either invent text for them or make them uneditable. This governs what
can be *written*, and an old holiday picks one up the next time it is saved.
"""

import pytest

URL = "/api/v1/holidays/"


def holiday(**overrides) -> dict:
    payload = {
        "date": "2026-12-26",
        "name": "Boxing Day",
        "description": "The day after Christmas; the office is closed.",
        "is_optional": False,
    }
    payload.update(overrides)
    return payload


@pytest.mark.django_db
def test_hr_can_add_a_holiday_with_a_description(auth_client, org):
    response = auth_client(org["hr"]).post(URL, holiday())

    assert response.status_code == 201, response.data
    assert response.data["description"] == "The day after Christmas; the office is closed."


@pytest.mark.django_db
def test_a_holiday_cannot_be_created_without_one(auth_client, org):
    response = auth_client(org["hr"]).post(URL, holiday(description=""))

    assert response.status_code == 400
    assert "description" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_field_cannot_simply_be_left_out(auth_client, org):
    payload = holiday()
    del payload["description"]

    response = auth_client(org["hr"]).post(URL, payload)

    assert response.status_code == 400
    assert "description" in response.data["error"]["details"]


@pytest.mark.django_db
def test_whitespace_is_not_a_description(auth_client, org):
    response = auth_client(org["hr"]).post(URL, holiday(description="   "))

    assert response.status_code == 400
    assert "description" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_refusal_says_what_to_do(auth_client, org):
    response = auth_client(org["hr"]).post(URL, holiday(description=""))

    message = " ".join(response.data["error"]["details"]["description"])
    assert "what this holiday is for" in message


@pytest.mark.django_db
def test_nothing_is_stored_when_it_is_refused(auth_client, org):
    from apps.leave_management.models import Holiday

    auth_client(org["hr"]).post(URL, holiday(description=""))

    assert not Holiday.objects.filter(name="Boxing Day").exists()


@pytest.mark.django_db
def test_a_saved_holiday_also_needs_one(auth_client, org):
    """ "Create or save" - editing a holiday must not blank the description."""
    from apps.leave_management.models import Holiday

    existing = Holiday.objects.create(
        date="2026-11-14", name="Founders Day", description="The company was founded."
    )

    response = auth_client(org["hr"]).patch(
        f"{URL}{existing.pk}/", {"description": ""}, format="json"
    )

    assert response.status_code == 400
    existing.refresh_from_db()
    assert existing.description == "The company was founded."


@pytest.mark.django_db
def test_a_holiday_recorded_before_the_rule_is_still_readable(auth_client, org):
    """Five of the seeded holidays have no description. They must keep working;
    the rule is about what gets written from now on."""
    from apps.leave_management.models import Holiday

    Holiday.objects.create(date="2026-01-26", name="Republic Day", description="")

    response = auth_client(org["employee"]).get(URL, {"page_size": 100})

    assert response.status_code == 200
    names = {row["name"] for row in response.data["results"]}
    assert "Republic Day" in names


@pytest.mark.django_db
def test_an_employee_still_cannot_add_a_holiday(auth_client, org):
    """The new field must not have loosened who may write one."""
    assert auth_client(org["employee"]).post(URL, holiday()).status_code == 403
