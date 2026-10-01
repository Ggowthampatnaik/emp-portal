"""Cross-cutting request middleware."""

import re
import uuid
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from common.request_context import set_client_ip, set_request_id, set_user_id

REQUEST_ID_HEADER = "HTTP_X_REQUEST_ID"
RESPONSE_HEADER = "X-Request-ID"

#: What an inbound correlation id may look like. Anything else is replaced:
#: the value is copied into every log line, audit row and response header, so
#: a newline in it forges log entries and a kilobyte of it bloats every store.
REQUEST_ID_SHAPE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def _client_ip(request: HttpRequest) -> str:
    """The address the trusted proxy saw, or the socket's if there is none.

    X-Forwarded-For is written by whoever sends the request and appended to by
    each proxy on the way. Only the entries the *trusted* proxies added can be
    believed, and they are the rightmost ones - so the client is ``hops`` from
    the right, never the first entry, which is the one the client chose.
    """
    hops = getattr(settings, "TRUSTED_PROXY_HOPS", 0)
    forwarded = [
        addr.strip()
        for addr in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
        if addr.strip()
    ]
    if hops and len(forwarded) >= hops:
        return forwarded[-hops]
    return request.META.get("REMOTE_ADDR", "-")


class RequestIDMiddleware:
    """Assigns (or honours) a correlation id and echoes it back to the client.

    Azure Front Door / Application Gateway forward ``X-Request-ID``; keeping the
    inbound value lets a single id follow a request across the whole stack and
    into Application Insights.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        inbound = request.META.get(REQUEST_ID_HEADER, "")
        request_id = inbound if REQUEST_ID_SHAPE.match(inbound) else uuid.uuid4().hex
        request.request_id = request_id  # type: ignore[attr-defined]
        set_request_id(request_id)
        set_client_ip(_client_ip(request))

        user = getattr(request, "user", None)
        set_user_id(str(user.pk) if user is not None and user.is_authenticated else "-")

        response = self.get_response(request)
        response[RESPONSE_HEADER] = request_id
        return response
