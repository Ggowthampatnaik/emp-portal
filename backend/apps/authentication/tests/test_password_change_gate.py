"""A temporary password opens the change-password screen and nothing else.

The SPA already sends the person there, but a gate that only the SPA enforces
is a suggestion: anyone calling the API directly could keep working on a
credential that arrived in plain text by email. The authentication layer is
the one place every request passes through, so the rule lives there - the
same place the Complete Profile gate already does.
"""

import pytest

ME = "/api/v1/auth/me/"
CHANGE = "/api/v1/auth/password/change/"
LOGOUT = "/api/v1/auth/logout/"
EMPLOYEES = "/api/v1/employees/"
LEAVE = "/api/v1/leaves/"


@pytest.fixture
def gated(auth_client, org):
    user = org["employee"].user
    user.must_change_password = True
    user.save(update_fields=["must_change_password"])
    return auth_client(org["employee"])


@pytest.mark.django_db
def test_the_portal_is_shut_until_the_password_is_changed(gated):
    for url in (EMPLOYEES, LEAVE):
        response = gated.get(url)
        assert response.status_code == 403, url
        assert "temporary password" in response.data["error"]["message"]


@pytest.mark.django_db
def test_the_way_out_stays_open(gated):
    # Who am I, so the SPA can render the screen; the change itself; and
    # leaving without changing anything.
    assert gated.get(ME).status_code == 200
    assert gated.post(CHANGE, {}).status_code == 400, "reached the view - validation, not the gate"
    assert gated.post(LOGOUT, {}).status_code == 204


@pytest.mark.django_db
def test_changing_it_opens_the_portal(gated, org):
    user = org["employee"].user
    user.set_password("Temp0rary#1")
    user.save(update_fields=["password"])

    response = gated.post(
        CHANGE, {"current_password": "Temp0rary#1", "new_password": "Chosen-by-me-99"}
    )
    assert response.status_code == 204

    user.refresh_from_db()
    assert user.must_change_password is False


@pytest.mark.django_db
def test_an_ordinary_session_is_untouched(auth_client, org):
    assert auth_client(org["employee"]).get(EMPLOYEES).status_code == 200
