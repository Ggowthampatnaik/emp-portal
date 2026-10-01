"""Infrastructure endpoints (not part of the versioned business API)."""

from django.conf import settings
from django.core.cache import cache
from django.core.files.storage import default_storage
from django.db import connection
from django.http import FileResponse, Http404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckView(APIView):
    """Liveness/readiness probe for Application Gateway and Container Apps."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(exclude=True)
    def get(self, request: Request) -> Response:
        checks = {"database": self._check_database(), "cache": self._check_cache()}
        healthy = all(state == "ok" for state in checks.values())
        return Response(
            {
                "status": "ok" if healthy else "degraded",
                "environment": settings.ENVIRONMENT,
                "version": settings.SPECTACULAR_SETTINGS["VERSION"],
                "checks": checks,
            },
            status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @staticmethod
    def _check_database() -> str:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception as exc:  # pragma: no cover - infrastructure failure
            return f"error: {exc.__class__.__name__}"
        return "ok"

    @staticmethod
    def _check_cache() -> str:
        try:
            cache.set("healthz", "1", 5)
            if cache.get("healthz") != "1":
                return "error: value not returned"
        except Exception as exc:  # pragma: no cover - infrastructure failure
            return f"error: {exc.__class__.__name__}"
        return "ok"


# ---------------------------------------------------------------------------
# Project-wide error handlers
#
# Requests that never reach a view (unrouted path, unhandled exception) bypass
# the DRF exception handler and would otherwise return Django HTML. API clients
# get the same JSON envelope as every other error.
# ---------------------------------------------------------------------------
def _is_api_request(request) -> bool:
    return request.path.startswith(f"/{settings.API_PREFIX}/")


def api_not_found(request, exception=None):
    from django.http import JsonResponse
    from django.views.defaults import page_not_found

    if not _is_api_request(request):
        return page_not_found(request, exception)
    return JsonResponse(
        {
            "error": {
                "code": "not_found",
                "message": "The requested resource was not found.",
                "request_id": getattr(request, "request_id", "-"),
            }
        },
        status=404,
    )


def api_server_error(request):
    from django.http import JsonResponse
    from django.views.defaults import server_error

    if not _is_api_request(request):
        return server_error(request)
    return JsonResponse(
        {
            "error": {
                "code": "server_error",
                "message": "An unexpected error occurred.",
                "request_id": getattr(request, "request_id", "-"),
            }
        },
        status=500,
    )


def signed_media(request, name: str):
    """An uploaded file stored on local disk, for a caller holding a signed link.

    `static()` used to serve this directory to anyone who asked. Uploads keep
    the name they were given and those names are formulaic - TRG0002-bachelors
    .pdf - so somebody's degree certificate was one guessed path away from a
    stranger with no account at all.

    The signature the API attached to the link is what opens the file, exactly
    as the SAS token does in production. That is what lets an <img> tag and a
    download link keep working: neither can send an Authorization header, and
    both carry a query string.

    Routed wherever MEDIA_SIGNING is on (development, Render, Hostinger); never
    on Azure, where Blob Storage serves the files itself.
    """
    from django.core.signing import BadSignature

    from common.media import verified_media_path

    try:
        signed_for = verified_media_path(request.GET.get("t", ""))
    except BadSignature:
        # Expired, tampered with, or absent. A 404 rather than a 403: whether
        # a given path exists is itself worth withholding.
        raise Http404("No such file.") from None

    if signed_for != name or not default_storage.exists(name):
        raise Http404("No such file.")

    return FileResponse(default_storage.open(name, "rb"))
