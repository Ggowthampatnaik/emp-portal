"""Root URL configuration.

All business endpoints live under the versioned ``/api/v1/`` prefix; the schema
and interactive documentation are served from ``/api/docs/``.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from common.views import HealthCheckView, api_not_found, api_server_error, signed_media

api_v1_patterns = [
    path("auth/", include("apps.authentication.urls")),
    path("", include("apps.employees.urls")),
    path("", include("apps.projects.urls")),
    path("", include("apps.leave_management.urls")),
    path("", include("apps.timesheets.urls")),
    path("", include("apps.payroll.urls")),
    path("", include("apps.finance.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.reports.urls")),
    path("", include("apps.administration.urls")),
]

# Branding for the maintenance admin (the portal itself is the primary UI).
admin.site.site_header = "Trigyan Employee Portal"
admin.site.site_title = "Trigyan Portal"
admin.site.index_title = "Maintenance"

urlpatterns = [
    path("healthz/", HealthCheckView.as_view(), name="health-check"),
    path(f"{settings.API_PREFIX}/v1/", include((api_v1_patterns, "v1"), namespace="v1")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

# The maintenance admin has its own session login that no portal throttle or
# lockout covers, so it exists only where it is wanted. See DJANGO_ADMIN_ENABLED.
if settings.DJANGO_ADMIN_ENABLED:
    urlpatterns.append(path(settings.DJANGO_ADMIN_PATH, admin.site.urls))

# Uploaded photos and documents are served by Django whenever it is the one
# signing their links: while developing, and on hosts that keep uploads on local
# disk (Render, Hostinger). Azure serves them straight from Blob Storage and
# turns MEDIA_SIGNING off. Not with `static()`, which serves anything to anyone:
# these are people's degree certificates, and the filenames are formulaic
# enough to guess. Every link the API hands out is signed, and this view checks
# the signature - the same shape as the SAS URLs Azure uses.
if settings.DEBUG or settings.MEDIA_SIGNING:
    # MEDIA_URL is normalised to "/media/"; a route may not begin with a slash.
    media_prefix = settings.MEDIA_URL.lstrip("/")
    urlpatterns.append(path(f"{media_prefix}<path:name>", signed_media, name="media"))

handler404 = api_not_found
handler500 = api_server_error
