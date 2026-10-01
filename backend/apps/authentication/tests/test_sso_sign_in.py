"""Microsoft SSO as the way in: MFA is enforced by Entra and checked here, and
password sign-in can be switched off for everyone but the break-glass accounts.

The Entra signature check is patched out - it is Microsoft's key, not ours - so
these pin what the portal does with a token once it is known to be genuine.
"""

from unittest import mock

import pytest
from django.test import override_settings

from conftest import PASSWORD

EXCHANGE_URL = "/api/v1/auth/entra/exchange/"
LOGIN_URL = "/api/v1/auth/login/"
FORGOT_URL = "/api/v1/auth/password/forgot/"
TENANT = "11111111-2222-3333-4444-555555555555"


def claims(**overrides) -> dict:
    return {
        "oid": "aaaaaaaa-0000-0000-0000-000000000001",
        "tid": TENANT,
        "preferred_username": "asha.rao@trigyan.io",
        "name": "Asha Rao",
        "amr": ["pwd", "mfa"],
        **overrides,
    }


def exchange(api_client, token_claims: dict):
    with mock.patch(
        "apps.authentication.authentication.validate_entra_token", return_value=token_claims
    ):
        return api_client.post(EXCHANGE_URL, HTTP_AUTHORIZATION="Bearer entra-token")


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_a_microsoft_sign_in_with_mfa_gets_a_portal_session(api_client, org):
    response = exchange(api_client, claims())

    assert response.status_code == 200, response.data
    assert response.data["access"] and response.data["refresh"]
    assert response.data["user"]["email"] == "asha.rao@trigyan.io"


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
@pytest.mark.parametrize("amr", [["pwd"], [], None])
def test_a_password_only_microsoft_sign_in_is_refused(api_client, org, amr, django_user_model):
    response = exchange(api_client, claims(amr=amr))

    assert response.status_code == 403
    assert response.data["error"]["code"] == "mfa_required"
    # Refused before provisioning: the account was not linked to the identity.
    assert not django_user_model.objects.filter(entra_object_id=claims()["oid"]).exists()


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_windows_hello_and_passkeys_count_as_mfa(api_client, org):
    assert exchange(api_client, claims(amr=["ngcmfa"])).status_code == 200


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT, ENTRA_REQUIRE_MFA=False)
def test_the_mfa_check_can_be_switched_off(api_client, org):
    assert exchange(api_client, claims(amr=["pwd"])).status_code == 200


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_the_first_microsoft_sign_in_retires_hrs_temporary_password(api_client, org):
    user = org["employee"].user
    user.must_change_password = True
    user.save(update_fields=["must_change_password"])

    response = exchange(api_client, claims())

    assert response.status_code == 200, response.data
    user.refresh_from_db()
    assert not user.must_change_password
    assert not user.has_usable_password()
    # The portal opens without detouring through the change-password screen.
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    assert api_client.get("/api/v1/dashboard/summary/").status_code == 200


@pytest.mark.django_db
@override_settings(PASSWORD_SIGN_IN_ENABLED=False)
def test_password_sign_in_can_be_switched_off(api_client, org):
    response = api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD})

    assert response.status_code == 403
    assert response.data["error"]["code"] == "password_sign_in_disabled"


@pytest.mark.django_db
@override_settings(
    PASSWORD_SIGN_IN_ENABLED=False,
    PASSWORD_SIGN_IN_ALLOWED_EMAILS=frozenset({"asha.rao@trigyan.io"}),
)
def test_a_break_glass_account_can_still_use_its_password(api_client, org):
    response = api_client.post(LOGIN_URL, {"email": "Asha.Rao@trigyan.io", "password": PASSWORD})

    assert response.status_code == 200, response.data


@pytest.mark.django_db
@override_settings(PASSWORD_SIGN_IN_ENABLED=False)
def test_a_refused_password_does_not_count_towards_the_lockout(api_client, org, django_user_model):
    for _ in range(15):
        api_client.post(LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": "wrong"})

    with override_settings(PASSWORD_SIGN_IN_ENABLED=True):
        response = api_client.post(
            LOGIN_URL, {"email": "asha.rao@trigyan.io", "password": PASSWORD}
        )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
@override_settings(PASSWORD_SIGN_IN_ENABLED=False)
def test_forgot_password_sends_nothing_when_passwords_are_off(api_client, org):
    with mock.patch("apps.authentication.views.request_password_reset") as reset:
        response = api_client.post(FORGOT_URL, {"email": "asha.rao@trigyan.io"})

    assert response.status_code == 204
    reset.assert_not_called()
