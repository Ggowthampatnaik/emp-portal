"""Administration: issuing credentials, and what that does to live sessions."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.administration.models import AuditLog
from common.enums import AuditAction, RoleSlug


@pytest.mark.django_db
def test_an_admin_reset_signs_the_account_out_everywhere(auth_client, org, api_client):
    """Found in end-to-end testing: the reset replaced the password but left
    every existing session working, for up to a week on the refresh token.

    An administrator resets a password precisely when somebody else may be
    holding that session, so it has to end with the credential.
    """
    from apps.authentication.views import issue_token_pair

    held = APIClient()
    held.credentials(
        HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(org['employee'].user)['access']}"
    )
    assert held.get("/api/v1/auth/me/").status_code == 200

    reset = auth_client(org["admin"]).post(
        f"/api/v1/admin/users/{org['employee'].user.pk}/reset-password/",
        {"temporary_password": "Reissued@2026"},
    )
    assert reset.status_code == 204

    assert held.get("/api/v1/auth/me/").status_code == 401, "the old session must be dead"

    fresh = api_client.post(
        "/api/v1/auth/login/",
        {"email": org["employee"].email, "password": "Reissued@2026"},
    )
    assert fresh.status_code == 200, "and the new credential must work"
    assert fresh.data["user"]["must_change_password"] is True


# ---------------------------------------------------------------------------
# Raising an account straight from the Admin module
# ---------------------------------------------------------------------------
# Employee onboarding raises an account alongside an employment record. This is
# the other door: somebody who needs to sign in without being on the payroll.
# The thing that matters is that it produces an *ordinary* account - the same
# hashed password the normal sign-in check reads, and the same first-login
# workflow - rather than a second and weaker way in.
CREATE_URL = "/api/v1/admin/users/"
NEW = {"email": "New.Person@trigyan.io", "temporary_password": "Welcome@2026"}


@pytest.mark.django_db
def test_an_administrator_creates_an_account(auth_client, org):
    response = auth_client(org["admin"]).post(CREATE_URL, NEW)

    assert response.status_code == 201, response.data
    assert response.data["email"] == "new.person@trigyan.io"
    assert response.data["must_change_password"] is True


@pytest.mark.django_db
def test_the_password_is_stored_hashed_and_signs_the_person_in(api_client, auth_client, org):
    """The whole point: what was stored is what the login check reads."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    user = get_user_model().objects.get(email="new.person@trigyan.io")
    assert user.password != "Welcome@2026", "the raw password must never be stored"
    assert user.check_password("Welcome@2026")

    signed_in = api_client.post(
        "/api/v1/auth/login/",
        {"email": "new.person@trigyan.io", "password": "Welcome@2026"},
    )
    assert signed_in.status_code == 200, signed_in.data
    assert signed_in.data["user"]["must_change_password"] is True


@pytest.mark.django_db
def test_the_first_login_workflow_continues_from_there(api_client, auth_client, org):
    """Sign in, be made to change it, sign in again with the new one."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    first = api_client.post(
        "/api/v1/auth/login/",
        {"email": "new.person@trigyan.io", "password": "Welcome@2026"},
    )
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {first.data['access']}")
    changed = api_client.post(
        "/api/v1/auth/password/change/",
        {"current_password": "Welcome@2026", "new_password": "TheirOwn@2026"},
    )
    assert changed.status_code == 204

    api_client.credentials()
    assert (
        api_client.post(
            "/api/v1/auth/login/",
            {"email": "new.person@trigyan.io", "password": "Welcome@2026"},
        ).status_code
        == 400
    ), "the temporary password must stop working"

    again = api_client.post(
        "/api/v1/auth/login/",
        {"email": "new.person@trigyan.io", "password": "TheirOwn@2026"},
    )
    assert again.status_code == 200
    assert again.data["user"]["must_change_password"] is False


@pytest.mark.django_db
def test_a_wrong_password_is_refused_for_a_new_account(api_client, auth_client, org):
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    response = api_client.post(
        "/api/v1/auth/login/", {"email": "new.person@trigyan.io", "password": "guessing"}
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_the_email_must_be_free(auth_client, org):
    client = auth_client(org["admin"])
    client.post(CREATE_URL, NEW)

    again = client.post(CREATE_URL, NEW)
    assert again.status_code == 400
    assert "email" in again.data["error"]["details"]


@pytest.mark.django_db
def test_the_email_clash_ignores_case(auth_client, org):
    response = auth_client(org["admin"]).post(
        CREATE_URL, {**NEW, "email": org["employee"].user.email.upper()}
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_weak_temporary_password_is_refused(auth_client, org):
    """It is a real credential for as long as it lasts."""
    response = auth_client(org["admin"]).post(CREATE_URL, {**NEW, "temporary_password": "12345678"})

    assert response.status_code == 400
    assert "temporary_password" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_new_account_starts_as_an_employee_only(auth_client, org):
    """Employee and nothing else: enough to see an employee's portal, and any
    further role is granted with the one control that already exists."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    user = get_user_model().objects.get(email="new.person@trigyan.io")
    assert sorted(user.role_slugs) == ["employee"]


@pytest.mark.django_db
def test_creating_an_account_needs_admin_manage_users(auth_client, org):
    for who in ("hr", "manager", "employee"):
        response = auth_client(org[who]).post(CREATE_URL, NEW)
        assert response.status_code == 403, f"{who} should not be able to create accounts"


@pytest.mark.django_db
def test_the_creation_is_audited(auth_client, org):
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    assert AuditLog.objects.filter(
        action=AuditAction.CREATE, entity_label__icontains="new.person@trigyan.io"
    ).exists()


# ---------------------------------------------------------------------------
# Deleting accounts - one, several, or all
# ---------------------------------------------------------------------------
DELETE_URL = "/api/v1/admin/users/delete/"


@pytest.mark.django_db
def test_an_administrator_deletes_an_account(auth_client, org):
    User = get_user_model()
    victim = User.objects.create_user(email="leaver@trigyan.io", password="Portal@123")

    response = auth_client(org["admin"]).post(DELETE_URL, {"ids": [victim.pk]}, format="json")

    assert response.status_code == 200
    assert response.data["deleted"] == 1
    assert not User.objects.filter(pk=victim.pk).exists()


@pytest.mark.django_db
def test_deleting_yourself_is_skipped_not_done(auth_client, org):
    """One click must not be able to lock every administrator out."""
    User = get_user_model()
    admin_user = org["admin"].user
    other = User.objects.create_user(email="other@trigyan.io", password="Portal@123")

    response = auth_client(org["admin"]).post(
        DELETE_URL, {"ids": [admin_user.pk, other.pk]}, format="json"
    )

    assert response.data["deleted"] == 1
    assert any("your own account" in line for line in response.data["skipped"])
    assert User.objects.filter(pk=admin_user.pk).exists()
    assert not User.objects.filter(pk=other.pk).exists()


@pytest.mark.django_db
def test_delete_all_is_not_an_administrator_action(auth_client, org):
    """Holding admin.manage_users is not consent to emptying the company."""
    User = get_user_model()
    before = User.objects.count()

    response = auth_client(org["admin"]).post(DELETE_URL, {"all": True}, format="json")

    assert response.status_code == 403
    assert "Super Admin" in str(response.data)
    assert User.objects.count() == before


@pytest.mark.django_db
def test_delete_all_spares_everyone_who_works_here(auth_client, org, super_admin_user):
    """Even for a Super Admin: removing a *person* is the closure flow, which
    takes two people. This endpoint clears accounts that never became one."""
    User = get_user_model()
    stray = User.objects.create_user(email="never-started@trigyan.io", password="Portal@123")
    employed = User.objects.exclude(employee_profile=None).count()

    response = auth_client(super_admin_user).post(DELETE_URL, {"all": True}, format="json")

    assert response.status_code == 200
    assert response.data["deleted"] == 1, "the stray account, and nothing else"
    assert not User.objects.filter(pk=stray.pk).exists()
    assert User.objects.exclude(employee_profile=None).count() == employed
    assert any("Account closures" in line for line in response.data["skipped"])


@pytest.mark.django_db
def test_an_employee_is_never_deleted_by_id_either(auth_client, org):
    User = get_user_model()
    victim = org["employee"].user

    response = auth_client(org["admin"]).post(DELETE_URL, {"ids": [victim.pk]}, format="json")

    assert response.data["deleted"] == 0
    assert any("Account closures" in line for line in response.data["skipped"])
    assert User.objects.filter(pk=victim.pk).exists()


@pytest.mark.django_db
def test_a_stale_id_is_reported_not_an_error(auth_client, org):
    response = auth_client(org["admin"]).post(DELETE_URL, {"ids": [999999]}, format="json")

    assert response.status_code == 200
    assert response.data["deleted"] == 0
    assert response.data["skipped"] == ["999999: no such account"]


@pytest.mark.django_db
def test_deleting_needs_manage_users(auth_client, org):
    response = auth_client(org["employee"]).post(DELETE_URL, {"all": True}, format="json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_an_empty_request_is_refused(auth_client, org):
    response = auth_client(org["admin"]).post(DELETE_URL, {}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
def test_the_user_search_finds_an_employee_code(auth_client, org):
    """The table shows the code, so the search box above it must match it."""
    code = org["employee"].employee_code

    response = auth_client(org["admin"]).get(CREATE_URL, {"search": code})

    emails = {row["email"] for row in response.data["results"]}
    assert org["employee"].user.email in emails


@pytest.mark.django_db
def test_the_user_search_still_finds_names_and_emails(auth_client, org):
    by_name = auth_client(org["admin"]).get(CREATE_URL, {"search": "Asha"})
    by_email = auth_client(org["admin"]).get(CREATE_URL, {"search": "asha.rao@"})

    for response in (by_name, by_email):
        assert org["employee"].user.email in {row["email"] for row in response.data["results"]}


@pytest.mark.django_db
def test_the_user_list_filters_by_department(auth_client, org):
    department_id = org["employee"].department_id

    response = auth_client(org["admin"]).get(CREATE_URL, {"department": department_id})

    emails = {row["email"] for row in response.data["results"]}
    assert org["employee"].user.email in emails
    # Accounts with no employment record in that department are gone.
    expected = org["employee"].department.name
    assert all(row["department"] == expected for row in response.data["results"])


@pytest.mark.django_db
def test_the_user_list_filters_by_employment_status(auth_client, org):
    response = auth_client(org["admin"]).get(CREATE_URL, {"employment_status": "active"})
    assert org["employee"].user.email in {row["email"] for row in response.data["results"]}

    none_left = auth_client(org["admin"]).get(CREATE_URL, {"employment_status": "inactive"})
    assert org["employee"].user.email not in {row["email"] for row in none_left.data["results"]}


@pytest.mark.django_db
def test_the_user_skills_filter_narrows_like_the_employees_one(auth_client, org):
    from apps.employees.models import EmployeeSkill, Skill

    skill = Skill.objects.create(name="React")
    EmployeeSkill.objects.create(employee=org["employee"], skill=skill)

    matching = auth_client(org["admin"]).get(CREATE_URL, {"skills": str(skill.pk)})
    assert org["employee"].user.email in {row["email"] for row in matching.data["results"]}

    other = Skill.objects.create(name="Fortran")
    both = auth_client(org["admin"]).get(CREATE_URL, {"skills": f"{skill.pk},{other.pk}"})
    assert org["employee"].user.email not in {row["email"] for row in both.data["results"]}


@pytest.mark.django_db
def test_a_malformed_skills_filter_is_a_clean_400(auth_client, org):
    response = auth_client(org["admin"]).get(CREATE_URL, {"skills": "React"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_nobody_can_change_their_own_roles(auth_client, org):
    """A Super Admin unticked their own role once and demoted themselves
    mid-session. Somebody else has to hold the pen."""
    admin_user = org["admin"].user

    response = auth_client(org["admin"]).post(
        f"/api/v1/admin/users/{admin_user.pk}/roles/", {"roles": ["employee"]}, format="json"
    )

    assert response.status_code == 403
    admin_user.refresh_from_db()
    assert "admin" in admin_user.role_slugs


# ---------------------------------------------------------------------------
# Onboarding: add user -> temp sign-in -> change password -> complete profile
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_new_account_comes_with_an_open_profile_gate(auth_client, org):
    """Add-user is the front door of onboarding: it must raise the employment
    record, or the profile gate never engages and the wizard is skipped."""
    from apps.employees.models import Employee

    auth_client(org["admin"]).post(CREATE_URL, NEW)

    employee = Employee.objects.get(user__email=NEW["email"].lower())
    assert employee.profile_completed is False
    assert employee.employee_code.startswith("TRG")


@pytest.mark.django_db
def test_new_codes_continue_the_numbering(auth_client, org):
    from apps.employees.models import Employee

    highest = max(
        int(code[3:])
        for code in Employee.objects.values_list("employee_code", flat=True)
        if code.startswith("TRG") and code[3:].isdigit()
    )

    auth_client(org["admin"]).post(CREATE_URL, NEW)

    employee = Employee.objects.get(user__email=NEW["email"].lower())
    assert employee.employee_code == f"TRG{highest + 1:04d}"


@pytest.mark.django_db
def test_the_portal_stays_shut_until_the_profile_is_submitted(auth_client, org, client):
    """The whole point of the workflow: sign in, change the password - and the
    portal is still closed until the profile is actually submitted."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    signin = client.post(
        "/api/v1/auth/login/",
        {"email": NEW["email"], "password": NEW["temporary_password"]},
        format="json",
    )
    token = signin.data["access"]
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    changed = client.post(
        "/api/v1/auth/password/change/",
        {
            "current_password": NEW["temporary_password"],
            "new_password": "Chosen@2026",
            "confirm_password": "Chosen@2026",
        },
        format="json",
        **headers,
    )
    assert changed.status_code in (200, 204), changed.data
    fresh = client.post(
        "/api/v1/auth/login/", {"email": NEW["email"], "password": "Chosen@2026"}, format="json"
    )
    headers = {"HTTP_AUTHORIZATION": f"Bearer {fresh.data['access']}"}

    assert fresh.data["user"]["profile_completed"] is False
    shut_out = client.get("/api/v1/leaves/", **headers)
    assert shut_out.status_code == 403

    me = client.get("/api/v1/employees/me/", **headers)
    employee_id = me.data["id"]

    # A draft saves what exists so far and opens nothing.
    draft = client.post(
        f"/api/v1/employees/{employee_id}/profile-draft/",
        {"phone": "+91 90000 12345", "gender": "female"},
        format="json",
        **headers,
    )
    assert draft.status_code == 200
    assert client.get("/api/v1/leaves/", **headers).status_code == 403

    # Coming back later, the draft is still there.
    again = client.get("/api/v1/employees/me/", **headers)
    assert again.data["phone"] == "+91 90000 12345"

    # Submitting the whole thing is what opens the portal.
    full = {
        "phone": "+91 90000 12345",
        "date_of_birth": "1998-04-12",
        "gender": "female",
        "blood_group": "O+",
        "permanent_address": "12 MG Road, Hyderabad",
        "current_address": "12 MG Road, Hyderabad",
        "emergency_contact_name": "R. Person",
        "emergency_contact_phone": "+91 90000 54321",
    }
    done = client.post(
        f"/api/v1/employees/{employee_id}/complete-profile/", full, format="json", **headers
    )
    assert done.status_code == 200
    assert client.get("/api/v1/leaves/", **headers).status_code == 200


@pytest.mark.django_db
def test_a_draft_with_a_bad_value_is_refused_cleanly(auth_client, org, client):
    """What is typed still has to be valid - a draft holding a phone number
    the final submit would reject helps nobody."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)
    signin = client.post(
        "/api/v1/auth/login/",
        {"email": NEW["email"], "password": NEW["temporary_password"]},
        format="json",
    )
    headers = {"HTTP_AUTHORIZATION": f"Bearer {signin.data['access']}"}
    # The temporary password opens the change-password screen and nothing
    # else - the wizard is behind it, so the change comes first here too.
    client.post(
        "/api/v1/auth/password/change/",
        {"current_password": NEW["temporary_password"], "new_password": "Chosen@2026"},
        format="json",
        **headers,
    )
    fresh = client.post(
        "/api/v1/auth/login/", {"email": NEW["email"], "password": "Chosen@2026"}, format="json"
    )
    headers = {"HTTP_AUTHORIZATION": f"Bearer {fresh.data['access']}"}
    me = client.get("/api/v1/employees/me/", **headers)

    draft = client.post(
        f"/api/v1/employees/{me.data['id']}/profile-draft/",
        {"phone": "not a phone"},
        format="json",
        **headers,
    )
    assert draft.status_code == 400


@pytest.mark.django_db
def test_a_new_joiner_starts_as_an_employee(auth_client, org):
    """An account with no role sees a sidebar of nothing - everyone joins as
    an employee, and anything more is granted from the table afterwards."""
    auth_client(org["admin"]).post(CREATE_URL, NEW)

    joiner = get_user_model().objects.get(email=NEW["email"].lower())
    assert sorted(joiner.role_slugs) == ["employee"]


@pytest.mark.django_db
def test_only_a_super_admin_can_grant_super_admin(auth_client, org, make_user):
    """An Admin holds `admin.manage_roles`, which is enough to hand out the
    working roles but not the one that bypasses every check."""
    target = org["employee"].user

    response = auth_client(org["admin"]).post(
        f"/api/v1/admin/users/{target.pk}/roles/",
        {"roles": ["employee", "super_admin"]},
        format="json",
    )
    assert response.status_code == 403
    target.refresh_from_db()
    assert "super_admin" not in target.role_slugs

    # A Super Admin may, and the ordinary roles stay available to an Admin.
    super_user = make_user("sneha.kulkarni@trigyan.io", RoleSlug.SUPER_ADMIN)
    granted = auth_client(super_user).post(
        f"/api/v1/admin/users/{target.pk}/roles/",
        {"roles": ["employee", "super_admin"]},
        format="json",
    )
    assert granted.status_code == 200, granted.data
    # role_slugs is cached on the instance; read a fresh one.
    target = get_user_model().objects.get(pk=target.pk)
    assert "super_admin" in target.role_slugs

    # ...and an Admin cannot take it away again either.
    revoked = auth_client(org["admin"]).post(
        f"/api/v1/admin/users/{target.pk}/roles/", {"roles": ["employee"]}, format="json"
    )
    assert revoked.status_code == 403

    manager = auth_client(org["admin"]).post(
        f"/api/v1/admin/users/{org['peer'].user.pk}/roles/",
        {"roles": ["employee", "manager"]},
        format="json",
    )
    assert manager.status_code == 200, manager.data
