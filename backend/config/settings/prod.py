"""Production settings (Azure Container Apps behind Application Gateway)."""

from .base import *  # noqa: F403
from .base import (
    ALLOWED_HOSTS,
    AZURE_ACCOUNT_NAME,
    AZURE_CONTAINER,
    EMAIL_BACKEND,
    INSECURE_DEV_SECRET_KEY,
    REST_FRAMEWORK,
    SECRET_KEY,
    STORAGES,
    env,
)
from .guards import check_production_config

DEBUG = False
ENVIRONMENT = env("DJANGO_ENV", default="production")

# --- Refusals ---------------------------------------------------------------
# Configuration mistakes a running site would hide. See settings/guards.py.
check_production_config(
    secret_key=SECRET_KEY,
    insecure_secret_key=INSECURE_DEV_SECRET_KEY,
    allowed_hosts=ALLOWED_HOSTS,
    email_backend=EMAIL_BACKEND,
)

# --- Maintenance admin ------------------------------------------------------
# Off unless deliberately switched on; its login sits outside every throttle
# and lockout the portal has. When on, set DJANGO_ADMIN_PATH to something
# other than the well-known name and restrict it at the gateway.
DJANGO_ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=False)

# --- Proxy trust ------------------------------------------------------------
# Application Gateway appends exactly one address to X-Forwarded-For, so the
# real client is one hop from the right. Override if another proxy is added.
TRUSTED_PROXY_HOPS = env.int("TRUSTED_PROXY_HOPS", default=1)
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": TRUSTED_PROXY_HOPS}

# --- HTTPS / transport security -------------------------------------------
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# --- Uploaded documents live in Azure Blob Storage -------------------------
# Blob Storage hands out SAS URLs that are already signed and already expire.
MEDIA_SIGNING = False

STORAGES = {
    **STORAGES,
    "default": {
        "BACKEND": "storages.backends.azure_storage.AzureStorage",
        "OPTIONS": {
            "account_name": AZURE_ACCOUNT_NAME,
            "azure_container": AZURE_CONTAINER,
            "expiration_secs": 3600,
        },
    },
}
