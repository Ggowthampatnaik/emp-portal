"""PIN code lookup: town, state and areas from India Post's directory.

The directory is patched out - these pin what the portal makes of its answers,
not whether a third-party site is up today.
"""

from unittest import mock

import pytest
import requests
from django.core.cache import cache

from common.pincode import LookupUnavailable, lookup_pincode, normalise_state

URL = "/api/v1/pincodes/{pin}/"


def office(name, district, state):
    return {"Name": name, "District": district, "State": state}


def directory(*offices, status="Success"):
    """What api.postalpincode.in answers."""
    response = mock.Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = [
        {"Status": status, "PostOffice": list(offices) if offices else None}
    ]
    return response


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.parametrize(
    ("state", "district", "expected"),
    [
        ("Andhra Pradesh", "Visakhapatnam", "Andhra Pradesh"),
        ("Jammu & Kashmir", "Srinagar", "Jammu and Kashmir"),
        ("Jammu & Kashmir", "Leh", "Ladakh"),  # a union territory since 2019
        ("Pondicherry", "Pondicherry", "Puducherry"),
        ("Andaman & Nicobar", "South Andaman", "Andaman and Nicobar Islands"),
        ("Daman & Diu", "Daman", "Dadra and Nagar Haveli and Daman and Diu"),
        (
            "Dadra & Nagar Haveli",
            "Dadra & Nagar Haveli",
            "Dadra and Nagar Haveli and Daman and Diu",
        ),
        ("Orissa", "Khordha", "Odisha"),
        ("Atlantis", "Nowhere", None),
    ],
)
def test_the_directorys_state_names_map_onto_todays(state, district, expected):
    assert normalise_state(state, district) == expected


def test_a_pin_gives_its_town_state_and_areas():
    answer = directory(
        office("Bodugullam Agraharam", "Visakhapatnam", "Andhra Pradesh"),
        office("Chandanada", "Visakhapatnam", "Andhra Pradesh"),
        office("Ch Laxmipuram", "Visakhapatnam", "Andhra Pradesh"),
    )
    with mock.patch("common.pincode.requests.get", return_value=answer):
        found = lookup_pincode("531081")

    assert found == {
        "pincode": "531081",
        "city": "Visakhapatnam",
        "state": "Andhra Pradesh",
        "states": ["Andhra Pradesh"],
        "areas": ["Bodugullam Agraharam", "Ch Laxmipuram", "Chandanada"],
    }


def test_the_most_common_district_is_the_town_and_shouting_is_tidied():
    answer = directory(
        office("Connaught Place", "NEW DELHI", "Delhi"),
        office("Parliament House", "NEW DELHI", "Delhi"),
        office("Baroda House", "Central Delhi", "Delhi"),
    )
    with mock.patch("common.pincode.requests.get", return_value=answer):
        found = lookup_pincode("110001")

    assert found["city"] == "New Delhi"
    assert found["state"] == "Delhi"


def test_a_pin_on_a_state_border_leaves_the_state_to_the_person():
    answer = directory(
        office("Silvassa", "Dadra & Nagar Haveli", "Dadra & Nagar Haveli"),
        office("Vapi", "Valsad", "Gujarat"),
    )
    with mock.patch("common.pincode.requests.get", return_value=answer):
        found = lookup_pincode("396230")

    assert found["state"] is None
    assert found["states"] == ["Dadra and Nagar Haveli and Daman and Diu", "Gujarat"]
    # "&" is not something the town field accepts, so it is spelled out.
    assert found["city"] in {"Dadra and Nagar Haveli", "Valsad"}


def test_answers_are_cached_so_the_directory_is_asked_once():
    answer = directory(office("Madhapur", "Hyderabad", "Telangana"))
    with mock.patch("common.pincode.requests.get", return_value=answer) as fetch:
        lookup_pincode("500081")
        lookup_pincode("500081")
    assert fetch.call_count == 1


def test_an_unknown_pin_is_none_and_remembered():
    with mock.patch("common.pincode.requests.get", return_value=directory(status="Error")) as fetch:
        assert lookup_pincode("999999") is None
        assert lookup_pincode("999999") is None
    assert fetch.call_count == 1


def test_an_unreachable_directory_is_an_error_and_is_not_remembered():
    with (
        mock.patch("common.pincode.requests.get", side_effect=requests.ConnectionError),
        pytest.raises(LookupUnavailable),
    ):
        lookup_pincode("500081")

    answer = directory(office("Madhapur", "Hyderabad", "Telangana"))
    with mock.patch("common.pincode.requests.get", return_value=answer):
        assert lookup_pincode("500081")["city"] == "Hyderabad"


def test_the_portal_names_itself_because_the_default_agent_is_refused():
    answer = directory(office("Madhapur", "Hyderabad", "Telangana"))
    with mock.patch("common.pincode.requests.get", return_value=answer) as fetch:
        lookup_pincode("500081")
    agent = fetch.call_args.kwargs["headers"]["User-Agent"]
    assert agent.startswith("TrigyanEmployeePortal/")


@pytest.mark.parametrize("pin", ["12345", "012345", "abcdef"])
def test_a_malformed_pin_never_reaches_the_directory(pin):
    with mock.patch("common.pincode.requests.get") as fetch:
        assert lookup_pincode(pin) is None
    fetch.assert_not_called()


# --- the endpoint -----------------------------------------------------------


@pytest.mark.django_db
def test_the_endpoint_answers_someone_still_completing_their_profile(auth_client, org):
    newcomer = org["employee"]
    newcomer.profile_completed = False
    newcomer.save(update_fields=["profile_completed"])
    answer = directory(office("Madhapur", "Hyderabad", "Telangana"))

    with mock.patch("common.pincode.requests.get", return_value=answer):
        response = auth_client(newcomer).get(URL.format(pin="500081"))

    assert response.status_code == 200, response.data
    assert response.data["city"] == "Hyderabad"
    assert response.data["state"] == "Telangana"


@pytest.mark.django_db
def test_an_unknown_pin_is_a_404(auth_client, org):
    with mock.patch("common.pincode.requests.get", return_value=directory(status="Error")):
        response = auth_client(org["employee"]).get(URL.format(pin="999999"))
    assert response.status_code == 404


@pytest.mark.django_db
def test_an_unreachable_directory_is_a_503_not_a_crash(auth_client, org):
    with mock.patch("common.pincode.requests.get", side_effect=requests.Timeout):
        response = auth_client(org["employee"]).get(URL.format(pin="500081"))
    assert response.status_code == 503


@pytest.mark.django_db
def test_signing_in_is_required(api_client):
    assert api_client.get(URL.format(pin="500081")).status_code == 401
