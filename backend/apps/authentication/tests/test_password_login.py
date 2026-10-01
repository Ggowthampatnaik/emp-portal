"""Email + password sign-in, token refresh and password change."""

import pytest

from apps.administration.models import AuditLog
from conftest import PASSWORD

LOGIN_URL = "/api/v1/auth/login/"


@pytest.mark.django_db
def test_signing_in_returns_a_token_pair_and_the_user(api_client, org):
    response = api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD})
    assert response.status_code == 200, response.data
    assert response.data["access"] and response.data["refresh"]

    user = response.data["user"]
    assert user["email"] == "asha.rao@trigyan.io"
    assert user["roles"] == ["employee"]
    assert user["employee_code"] == "TRG0005"
    assert "leave.apply" in user["permissions"]


@pytest.mark.django_db
def test_the_access_token_works_on_a_protected_endpoint(api_client, org):
    token = api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD}).data[
        "access"
    ]

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert api_client.get("/api/v1/auth/me/").status_code == 200


@pytest.mark.django_db
def test_the_refresh_token_mints_a_new_access_token(api_client, org):
    refresh = api_client.post(
        LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD}
    ).data["refresh"]

    response = api_client.post("/api/v1/auth/token/refresh/", {"refresh": refresh})
    assert response.status_code == 200
    assert response.data["access"]


@pytest.mark.django_db
def test_a_wrong_password_is_refused(api_client, org):
    response = api_client.post(
        LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": "not-the-password"}
    )
    assert response.status_code == 400
    assert "incorrect" in str(response.data["error"])


@pytest.mark.django_db
def test_an_unknown_account_gives_the_same_message(api_client, org):
    """The wording must not reveal whether the address exists."""
    unknown = api_client.post(LOGIN_URL, {"email": "nobody@trigyan.io", "password": PASSWORD})
    wrong = api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": "wrong-one"})
    assert unknown.status_code == wrong.status_code == 400
    assert str(unknown.data["error"]["details"]) == str(wrong.data["error"]["details"])


@pytest.mark.django_db
def test_a_deactivated_account_cannot_sign_in(api_client, org):
    user = org["employee"].user
    user.is_active = False
    user.save(update_fields=["is_active"])

    response = api_client.post(LOGIN_URL, {"email": user.email, "password": PASSWORD})
    assert response.status_code == 400


@pytest.mark.django_db
def test_sign_in_is_recorded_in_the_audit_trail(api_client, org):
    api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD})
    entry = AuditLog.objects.filter(action="login").first()
    assert entry is not None
    assert entry.actor_email == "asha.rao@trigyan.io"


@pytest.mark.django_db
def test_changing_the_password_works_and_the_old_one_stops(api_client, auth_client, org):
    client = auth_client(org["employee"])
    response = client.post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": "Brand@New2026"},
    )
    assert response.status_code == 204

    client.credentials()  # drop the token; sign in afresh
    assert (
        client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD}).status_code
        == 400
    )
    assert (
        client.post(
            LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": "Brand@New2026"}
        ).status_code
        == 200
    )


@pytest.mark.django_db
def test_the_current_password_must_be_correct(auth_client, org):
    response = auth_client(org["employee"]).post(
        "/api/v1/auth/password/change/",
        {"current_password": "wrong", "new_password": "Brand@New2026"},
    )
    assert response.status_code == 400
    assert "current_password" in response.data["error"]["details"]


@pytest.mark.django_db
def test_a_weak_new_password_is_refused(auth_client, org):
    response = auth_client(org["employee"]).post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": "12345678"},
    )
    assert response.status_code == 400
    assert "new_password" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_new_password_must_differ(auth_client, org):
    response = auth_client(org["employee"]).post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": PASSWORD},
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_logout_records_the_event(auth_client, org):
    assert auth_client(org["employee"]).post("/api/v1/auth/logout/").status_code == 204
    assert AuditLog.objects.filter(action="logout").exists()


@pytest.mark.django_db
def test_the_photo_url_on_me_is_absolute(api_client, auth_client, org, settings, tmp_path):
    """A relative URL would resolve against the SPA origin, not the API."""
    from apps.employees.tests.test_profile_photo import make_image

    settings.MEDIA_ROOT = tmp_path
    employee = org["employee"]
    client = auth_client(employee)
    client.post(
        f"/api/v1/employees/{employee.pk}/photo/", {"photo": make_image()}, format="multipart"
    )

    response = client.get("/api/v1/auth/me/")
    assert response.status_code == 200
    assert response.data["photo_url"].startswith("http://")


# ---------------------------------------------------------------------------
# Changing a password signs you out
# ---------------------------------------------------------------------------
# A password is changed either because it was temporary or because somebody may
# know it. Both cases want every token issued against the old one to stop
# working - and the SPA cannot promise that on its own, because a token it has
# already handed out lives outside the browser.
@pytest.mark.django_db
def test_the_session_that_changed_the_password_stops_working(auth_client, org):
    client = auth_client(org["employee"])
    changed = client.post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": "Brand@New2026"},
    )
    assert changed.status_code == 204

    assert client.get("/api/v1/auth/me/").status_code == 401, "the old token must be dead"


@pytest.mark.django_db
def test_every_other_session_stops_too(auth_client, org):
    """Two devices signed in; changing the password on one closes the other."""
    phone = auth_client(org["employee"])
    laptop = auth_client(org["employee"])

    laptop.post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": "Brand@New2026"},
    )

    assert phone.get("/api/v1/auth/me/").status_code == 401


@pytest.mark.django_db
def test_signing_in_again_with_the_new_password_works(api_client, auth_client, org):
    auth_client(org["employee"]).post(
        "/api/v1/auth/password/change/",
        {"current_password": PASSWORD, "new_password": "Brand@New2026"},
    )

    response = api_client.post(
        LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": "Brand@New2026"}
    )
    assert response.status_code == 200, response.data
    assert response.data["user"]["must_change_password"] is False


@pytest.mark.django_db
def test_a_refused_change_leaves_the_session_alone(auth_client, org):
    """Only a change that happened should cost you your session."""
    client = auth_client(org["employee"])
    client.post(
        "/api/v1/auth/password/change/",
        {"current_password": "wrong", "new_password": "Brand@New2026"},
    )

    assert client.get("/api/v1/auth/me/").status_code == 200
