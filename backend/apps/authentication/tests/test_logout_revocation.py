"""Signing out has to end the session, not just the browser's copy of it.

Before this, logout recorded an audit line and nothing else: the refresh token
stayed usable for its whole seven days, so anything holding a copy could keep
minting access tokens from an account that believed it had signed out. These
pin the revocation, and the two things it must not do - fail loudly, or end
sessions other than the one signing out.
"""

import pytest

LOGIN_URL = "/api/v1/auth/login/"
LOGOUT_URL = "/api/v1/auth/logout/"
REFRESH_URL = "/api/v1/auth/token/refresh/"

PASSWORD = "Portal@123"


@pytest.fixture
def account(employee_user):
    employee_user.set_password(PASSWORD)
    employee_user.save(update_fields=["password"])
    return employee_user


def sign_in(api_client, account) -> dict:
    response = api_client.post(
        LOGIN_URL, {"email": account.email, "password": PASSWORD}, format="json"
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.django_db
def test_the_refresh_token_stops_working_after_sign_out(api_client, account):
    tokens = sign_in(api_client, account)

    # It works before.
    assert (
        api_client.post(REFRESH_URL, {"refresh": tokens["refresh"]}, format="json").status_code
        == 200
    )

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert (
        api_client.post(LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json").status_code
        == 204
    )

    api_client.credentials()
    after = api_client.post(REFRESH_URL, {"refresh": tokens["refresh"]}, format="json")
    assert after.status_code == 401


@pytest.mark.django_db
def test_signing_out_one_session_leaves_the_others_alone(api_client, account):
    laptop = sign_in(api_client, account)
    phone = sign_in(api_client, account)

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {laptop['access']}")
    api_client.post(LOGOUT_URL, {"refresh": laptop["refresh"]}, format="json")
    api_client.credentials()

    # The phone is still signed in. Revoking every session on sign-out would be
    # a different feature, and a surprising one.
    assert (
        api_client.post(REFRESH_URL, {"refresh": phone["refresh"]}, format="json").status_code
        == 200
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="no token sent"),
        pytest.param({"refresh": ""}, id="empty token"),
        pytest.param({"refresh": "not-a-token"}, id="malformed token"),
    ],
)
def test_sign_out_always_succeeds(api_client, account, payload):
    """A client that cannot produce its token must still be able to leave."""
    tokens = sign_in(api_client, account)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    assert api_client.post(LOGOUT_URL, payload, format="json").status_code == 204


@pytest.mark.django_db
def test_signing_out_twice_is_not_an_error(api_client, account):
    tokens = sign_in(api_client, account)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    assert (
        api_client.post(LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json").status_code
        == 204
    )
    assert (
        api_client.post(LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json").status_code
        == 204
    )


@pytest.mark.django_db
def test_a_rotated_refresh_token_retires_the_one_it_replaced(api_client, account):
    """Rotation without retirement leaves two live tokens where there was one."""
    tokens = sign_in(api_client, account)

    rotated = api_client.post(REFRESH_URL, {"refresh": tokens["refresh"]}, format="json")
    assert rotated.status_code == 200

    reused = api_client.post(REFRESH_URL, {"refresh": tokens["refresh"]}, format="json")
    assert reused.status_code == 401, "the old refresh token must not survive rotation"
