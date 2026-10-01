"""First login and the Complete Profile gate (F18, decision D11).

HR creates the account; there is no self-signup. The new employee signs in with
temporary credentials, is forced to change the password, and then has to fill in
their profile before anything else opens.

The plan calls that a **hard** gate, and this file is mostly about the word
"hard": a redirect in the SPA is not a control, so the same rule is enforced on
every endpoint and tested by calling the API directly.
"""

import pytest

from apps.employees.models import MANDATORY_PROFILE_FIELDS, ExperienceDetail

COMPLETE = "/api/v1/employees/{pk}/complete-profile/"

FULL_PROFILE = {
    "phone": "+91 98765 43210",
    "date_of_birth": "1996-04-12",
    "gender": "female",
    "blood_group": "O+",
    "permanent_address": "12 MG Road, Bengaluru 560001",
    "current_address": "44 Jubilee Hills, Hyderabad 500033",
    "emergency_contact_name": "Rekha Rao",
    "emergency_contact_phone": "+91 98765 11111",
}


@pytest.fixture
def newcomer(org):
    """Someone HR has just created: signed in, password changed, profile empty."""
    employee = org["employee"]
    employee.profile_completed = False
    employee.save(update_fields=["profile_completed"])
    return employee


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------
@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/leaves/",
        "/api/v1/timesheets/",
        "/api/v1/projects/",
        "/api/v1/payslips/",
        "/api/v1/employees/",
        "/api/v1/dashboard/summary/",
        "/api/v1/employees/directory/",
    ],
)
def test_the_portal_is_shut_until_the_profile_is_done(auth_client, newcomer, path):
    """Typing the URL is exactly the bypass the gate exists to stop."""
    response = auth_client(newcomer).get(path)
    assert response.status_code == 403, f"{path} should be closed"
    assert "Complete your profile" in str(response.data)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/me/",
        "/api/v1/employees/me/",
        "/api/v1/departments/",
        "/api/v1/designations/",
        "/api/v1/skills/",
        "/api/v1/notifications/",
    ],
)
def test_the_wizard_can_still_reach_what_it_needs(auth_client, newcomer, path):
    response = auth_client(newcomer).get(path)
    assert response.status_code == 200, f"{path} is needed to fill the form in"


@pytest.mark.django_db
def test_signing_out_is_always_possible(auth_client, newcomer):
    """Being stuck in a wizard with no way out would be its own bug."""
    assert auth_client(newcomer).post("/api/v1/auth/logout/", {}).status_code == 204


@pytest.mark.django_db
def test_the_gate_does_not_apply_to_anyone_already_complete(auth_client, org):
    assert auth_client(org["employee"]).get("/api/v1/leaves/").status_code == 200


@pytest.mark.django_db
def test_the_gate_does_not_apply_to_an_account_with_no_employee_record(
    auth_client, make_user, api_client
):
    """A bare administrator has no profile to complete."""
    from apps.authentication.views import issue_token_pair
    from common.enums import RoleSlug

    admin = make_user("bare.admin@trigyan.io", RoleSlug.ADMIN)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(admin)['access']}")

    assert api_client.get("/api/v1/auth/me/").status_code == 200
    assert api_client.get("/api/v1/employees/").status_code == 200


@pytest.mark.django_db
def test_auth_me_tells_the_spa_the_gate_is_closed(auth_client, newcomer):
    response = auth_client(newcomer).get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.data["profile_completed"] is False


@pytest.mark.django_db
def test_someone_elses_profile_endpoint_is_not_a_way_round_it(auth_client, newcomer, org):
    """The allowlist is keyed on the caller's own record, not any record."""
    response = auth_client(newcomer).post(
        COMPLETE.format(pk=org["peer"].pk), FULL_PROFILE, format="json"
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Completing it
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_full_submission_opens_the_portal(auth_client, newcomer):
    client = auth_client(newcomer)

    response = client.post(COMPLETE.format(pk=newcomer.pk), FULL_PROFILE, format="json")

    assert response.status_code == 200, response.data
    assert response.data["profile_completed"] is True

    newcomer.refresh_from_db()
    assert newcomer.profile_completed is True
    assert client.get("/api/v1/leaves/").status_code == 200, "the portal is open now"


@pytest.mark.django_db
def test_what_was_typed_is_what_is_saved(auth_client, newcomer):
    auth_client(newcomer).post(COMPLETE.format(pk=newcomer.pk), FULL_PROFILE, format="json")

    newcomer.refresh_from_db()
    assert newcomer.phone == FULL_PROFILE["phone"]
    assert str(newcomer.date_of_birth) == FULL_PROFILE["date_of_birth"]
    assert newcomer.blood_group == "O+"
    assert newcomer.emergency_contact_name == "Rekha Rao"


@pytest.mark.django_db
@pytest.mark.parametrize("missing", MANDATORY_PROFILE_FIELDS)
def test_the_flag_flips_only_when_every_field_is_there(auth_client, newcomer, missing):
    payload = {key: value for key, value in FULL_PROFILE.items() if key != missing}

    response = auth_client(newcomer).post(COMPLETE.format(pk=newcomer.pk), payload, format="json")

    assert response.status_code == 400, f"{missing} should be required"
    assert missing in response.data["error"]["details"]

    newcomer.refresh_from_db()
    assert newcomer.profile_completed is False


@pytest.mark.django_db
def test_a_blank_value_does_not_count_as_filled_in(auth_client, newcomer):
    response = auth_client(newcomer).post(
        COMPLETE.format(pk=newcomer.pk),
        {**FULL_PROFILE, "permanent_address": "   "},
        format="json",
    )

    assert response.status_code == 400
    newcomer.refresh_from_db()
    assert newcomer.profile_completed is False


@pytest.mark.django_db
def test_completing_it_is_recorded(auth_client, newcomer):
    from apps.administration.models import AuditLog

    auth_client(newcomer).post(COMPLETE.format(pk=newcomer.pk), FULL_PROFILE, format="json")

    entry = AuditLog.objects.filter(entity_type="Employee").latest("created_at")
    assert entry.changes["profile_completed"] is True


@pytest.mark.django_db
def test_submitting_again_is_harmless(auth_client, newcomer):
    client = auth_client(newcomer)
    client.post(COMPLETE.format(pk=newcomer.pk), FULL_PROFILE, format="json")

    again = client.post(
        COMPLETE.format(pk=newcomer.pk),
        {**FULL_PROFILE, "phone": "+91 90000 00000"},
        format="json",
    )

    assert again.status_code == 200
    newcomer.refresh_from_db()
    assert newcomer.phone == "+91 90000 00000"


# ---------------------------------------------------------------------------
# Experience details
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_records_their_previous_jobs(auth_client, org):
    response = auth_client(org["employee"]).put(
        f"/api/v1/employees/{org['employee'].pk}/experience/",
        {
            "experience": [
                {
                    "company_name": "Northwind Systems",
                    "job_title": "Software Engineer",
                    "from_date": "2019-06-01",
                    "to_date": "2022-01-02",
                    "description": "Payments team.",
                },
                {
                    "company_name": "Contoso",
                    "job_title": "Intern",
                    "from_date": "2018-05-01",
                    "to_date": "2018-08-31",
                },
            ]
        },
        format="json",
    )

    assert response.status_code == 200, response.data
    assert [row["company_name"] for row in response.data] == ["Northwind Systems", "Contoso"]
    assert ExperienceDetail.objects.filter(employee=org["employee"]).count() == 2


@pytest.mark.django_db
def test_an_open_ended_job_is_allowed(auth_client, org):
    response = auth_client(org["employee"]).put(
        f"/api/v1/employees/{org['employee'].pk}/experience/",
        {
            "experience": [
                {
                    "company_name": "Contoso",
                    "job_title": "Engineer",
                    "from_date": "2018-05-01",
                }
            ]
        },
        format="json",
    )

    assert response.status_code == 200
    assert response.data[0]["is_current"] is True


@pytest.mark.django_db
def test_dates_the_wrong_way_round_are_refused(auth_client, org):
    response = auth_client(org["employee"]).put(
        f"/api/v1/employees/{org['employee'].pk}/experience/",
        {
            "experience": [
                {
                    "company_name": "Contoso",
                    "job_title": "Engineer",
                    "from_date": "2020-01-01",
                    "to_date": "2019-01-01",
                }
            ]
        },
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_saving_replaces_the_whole_history(auth_client, org):
    client = auth_client(org["employee"])
    url = f"/api/v1/employees/{org['employee'].pk}/experience/"
    client.put(
        url,
        {"experience": [{"company_name": "A", "job_title": "X", "from_date": "2019-01-01"}]},
        format="json",
    )

    client.put(
        url,
        {"experience": [{"company_name": "B", "job_title": "Y", "from_date": "2020-01-01"}]},
        format="json",
    )

    assert [row.company_name for row in org["employee"].experience_details.all()] == ["B"]


@pytest.mark.django_db
def test_a_colleague_cannot_rewrite_your_history(auth_client, org):
    response = auth_client(org["peer"]).put(
        f"/api/v1/employees/{org['employee'].pk}/experience/",
        {"experience": []},
        format="json",
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Education documents
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_education_document_types_exist():
    """The wizard asks for these by name, so they have to be real choices."""
    from apps.employees.models import EmployeeDocument

    values = set(EmployeeDocument.DocumentType.values)
    assert {
        "tenth",
        "intermediate",
        "bachelors",
        "masters",
        "other_education",
        "experience_letter",
    } <= values


@pytest.mark.django_db
def test_the_old_document_types_still_work():
    """Existing rows use them; removing a choice would orphan the data."""
    from apps.employees.models import EmployeeDocument

    values = set(EmployeeDocument.DocumentType.values)
    assert {"id_proof", "address_proof", "education", "experience", "contract", "other"} <= values
