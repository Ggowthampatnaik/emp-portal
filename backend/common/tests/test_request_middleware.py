"""What the request middleware believes about the request.

Two headers arrive from the client and both used to be taken at face value.
``X-Forwarded-For`` fed the login throttle and the audit trail, so a request
could name any address it liked. ``X-Request-ID`` is copied into every log
line, audit row and response, so it could carry newlines or a kilobyte of
anything. These pin the trust rules: the forwarded address counts only from
the proxies we know about, from the right; the correlation id keeps only a
sane shape.
"""

import pytest
from django.test import override_settings

from common.request_context import get_client_ip, get_request_id

HEALTH = "/healthz/"


@pytest.mark.django_db
@override_settings(TRUSTED_PROXY_HOPS=0)
def test_with_no_proxy_the_forwarded_header_is_ignored(api_client):
    api_client.get(HEALTH, HTTP_X_FORWARDED_FOR="203.0.113.9", REMOTE_ADDR="10.0.0.5")

    # The header is whatever the client typed; the socket is what it used.
    assert get_client_ip() == "10.0.0.5"


@pytest.mark.django_db
@override_settings(TRUSTED_PROXY_HOPS=1)
def test_behind_one_proxy_the_client_is_the_last_entry(api_client):
    # The client wrote the first entry itself; the gateway appended the real one.
    api_client.get(HEALTH, HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.7", REMOTE_ADDR="10.0.0.5")

    assert get_client_ip() == "198.51.100.7"


@pytest.mark.django_db
@override_settings(TRUSTED_PROXY_HOPS=1)
def test_a_missing_header_behind_a_proxy_falls_back_to_the_socket(api_client):
    api_client.get(HEALTH, REMOTE_ADDR="10.0.0.5")

    assert get_client_ip() == "10.0.0.5"


@pytest.mark.django_db
def test_a_well_formed_request_id_is_kept(api_client):
    response = api_client.get(HEALTH, HTTP_X_REQUEST_ID="gateway-7f3c2a91")

    assert response["X-Request-ID"] == "gateway-7f3c2a91"
    assert get_request_id() == "gateway-7f3c2a91"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "bad",
    [
        pytest.param("abc", id="too short to be an id"),
        pytest.param("x" * 65, id="too long"),
        pytest.param("id-1234\nINFO forged line", id="carries a newline"),
        pytest.param("<script>alert(1)</script>", id="carries markup"),
        pytest.param("id 1234 5678", id="carries spaces"),
    ],
)
def test_a_malformed_request_id_is_replaced(api_client, bad):
    response = api_client.get(HEALTH, HTTP_X_REQUEST_ID=bad)

    issued = response["X-Request-ID"]
    assert issued != bad
    assert len(issued) == 32 and issued.isalnum(), "a fresh uuid hex"
