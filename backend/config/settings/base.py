"""Shared Django settings for the Trigyan Employee Management Portal.

Environment-specific overrides live in dev.py, staging.py and prod.py.
All secrets are read from the environment (locally via .env, on Azure via
App Settings backed by Key Vault) - never committed.
"""

from datetime import timedelta
from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parents[2]

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    ENTRA_TENANT_ID=(str, ""),
    ENTRA_CLIENT_ID=(str, ""),
    ENTRA_AUDIENCE=(str, ""),
    AZURE_STORAGE_ACCOUNT_NAME=(str, ""),
    AZURE_STORAGE_CONTAINER=(str, "employee-documents"),
    APPLICATIONINSIGHTS_CONNECTION_STRING=(str, ""),
)
environ.Env.read_env(BASE_DIR / ".env")

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
# Named rather than inlined so production can refuse to start on it. A signing
# key that ships in the repository signs anybody's tokens, not just ours.
INSECURE_DEV_SECRET_KEY = "insecure-dev-key-change-me"
SECRET_KEY = env("DJANGO_SECRET_KEY", default=INSECURE_DEV_SECRET_KEY)
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")
ENVIRONMENT = env("DJANGO_ENV", default="dev")

API_PREFIX = "api"

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    # Signing out has to revoke the refresh token server-side; without this app
    # a stolen one keeps minting access tokens until it expires, whatever the
    # browser does with its copy.
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "django_celery_beat",
    "django_celery_results",
]

LOCAL_APPS = [
    "common",
    "apps.authentication",
    "apps.employees",
    "apps.projects",
    "apps.leave_management",
    "apps.timesheets",
    "apps.payroll",
    "apps.finance",
    "apps.notifications",
    "apps.reports",
    "apps.administration",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "common.middleware.RequestIDMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database - PostgreSQL
# ---------------------------------------------------------------------------
DATABASES = {
    "default": env.db_url(
        "DATABASE_URL",
        default="postgres://postgres:postgres@localhost:5432/emp_portal",
    )
}
DATABASES["default"]["ATOMIC_REQUESTS"] = True
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "authentication.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Cache / queue - Redis
# ---------------------------------------------------------------------------
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        "KEY_PREFIX": "empportal",
    }
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = "django-db"
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_TIME_LIMIT = 15 * 60
CELERY_TASK_SOFT_TIME_LIMIT = 13 * 60
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"

# Housekeeping that has to happen whether or not anyone remembers to set it up.
# The database scheduler reads these on start and writes them into its own
# table, so they survive a deployment and need no admin page to create - which
# matters, because DJANGO_ADMIN_ENABLED is off in production.
#
# Both tables grow with ordinary use and nothing else prunes them: every token
# refresh blacklists its predecessor, and every password reset leaves a hashed
# token behind.
CELERY_BEAT_SCHEDULE = {
    "flush-expired-jwt": {
        "task": "apps.authentication.tasks.flush_expired_tokens",
        "schedule": crontab(hour=3, minute=30),
    },
    "purge-spent-reset-tokens": {
        "task": "apps.authentication.tasks.purge_reset_tokens",
        "schedule": crontab(hour=3, minute=40),
    },
}

# ---------------------------------------------------------------------------
# Internationalisation
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TIME_ZONE", default="Asia/Kolkata")
CELERY_TIMEZONE = TIME_ZONE
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static / media - Azure Blob Storage in deployed environments
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
# Django is serving the uploads itself, so the API signs every link it hands
# out and the media view checks the signature - see common/media.py. Storage
# backends that sign their own URLs (Azure, S3) turn this off; production does.
MEDIA_SIGNING = env.bool("MEDIA_SIGNING", default=True)
MEDIA_ROOT = BASE_DIR / "media"

AZURE_ACCOUNT_NAME = env("AZURE_STORAGE_ACCOUNT_NAME")
AZURE_CONTAINER = env("AZURE_STORAGE_CONTAINER")

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.authentication.authentication.EntraIDJWTAuthentication",
        # SimpleJWT plus the token-version check that ends old sessions after a
        # password reset - see apps/authentication/portal_jwt.py.
        "apps.authentication.portal_jwt.PortalJWTAuthentication",
    ),
    # The Complete Profile gate is *not* here: a declared permission_classes on
    # a viewset replaces this list, and nearly every viewset declares one. It is
    # enforced in the authentication class instead - see common/profile_gate.py.
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    "DEFAULT_THROTTLE_RATES": {"login": "10/min", "reports": "30/min"},
    # How many proxies sit in front of the app and append to X-Forwarded-For.
    # Zero means the header is ignored: it is written by the client, and a
    # throttle keyed on it can be reset by changing a request header. See the
    # same setting in common/middleware.py, which the audit trail uses.
    "NUM_PROXIES": env.int("TRUSTED_PROXY_HOPS", default=0),
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

# Read by the request middleware for the audit trail; DRF reads its copy above.
TRUSTED_PROXY_HOPS = REST_FRAMEWORK["NUM_PROXIES"]

#: How long a temporary password stays usable (F17 / decision D8).
PASSWORD_RESET_MINUTES = env.int("PASSWORD_RESET_MINUTES", default=30)

# ---------------------------------------------------------------------------
# Django maintenance admin
# ---------------------------------------------------------------------------
# The portal is the UI; the Django admin is a maintenance tool with its own
# session login that none of the portal's throttles or lockouts cover. It is
# routed only when switched on, and off is the default outside development -
# there is nothing to brute-force at a path that does not exist. When it is
# on, keep the path off the well-known name and restrict it at the gateway.
DJANGO_ADMIN_ENABLED = env.bool("DJANGO_ADMIN_ENABLED", default=DEBUG)
DJANGO_ADMIN_PATH = env("DJANGO_ADMIN_PATH", default="django-admin/").strip("/") + "/"

# ---------------------------------------------------------------------------
# Sign-in lockout
# ---------------------------------------------------------------------------
# The login throttle counts requests per address; this counts failures per
# account, which is the number that matters when the guesses are spread across
# many addresses. Set the attempt count to 0 to switch it off entirely.
LOGIN_LOCKOUT_ATTEMPTS = env.int("LOGIN_LOCKOUT_ATTEMPTS", default=10)
LOGIN_LOCKOUT_MINUTES = env.int("LOGIN_LOCKOUT_MINUTES", default=15)
LOGIN_LOCKOUT_WINDOW_MINUTES = env.int("LOGIN_LOCKOUT_WINDOW_MINUTES", default=15)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": True,
    # Rotation without blacklisting leaves the old refresh token usable for its
    # whole seven days, so a copy taken at any point stays live alongside the
    # real session. Retiring it on rotation is what makes rotation mean
    # anything. Expired rows are cleared by `manage.py flushexpiredtokens`.
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Trigyan Employee Management Portal API",
    "DESCRIPTION": (
        "REST API for employee, project, leave and timesheet management. "
        "Authentication is Microsoft Entra ID SSO exchanged for a portal JWT; "
        "every endpoint is guarded by role-based access control."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # The schema is the map of every route, parameter and permission. Handing
    # it to an anonymous visitor is the reconnaissance step of an attack,
    # pre-written. dev.py opens it up for local work.
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
    "SCHEMA_PATH_PREFIX": "/api/v[0-9]",
    "COMPONENT_SPLIT_REQUEST": True,
    "SORT_OPERATIONS": False,
    # Several models expose a "status" field over different choice sets; name
    # each enum explicitly so the generated client has readable type names.
    # Both leave/timesheet status and project status are called "status"; name
    # the two enums explicitly so the generated client stays readable.
    "ENUM_NAME_OVERRIDES": {
        "ApprovalStatusEnum": "common.enums.ApprovalStatus.choices",
        "LeaveStatusEnum": "common.enums.LeaveStatus.choices",
        "LeaveStageStatusEnum": "common.enums.LeaveStageStatus.choices",
        "ProjectStatusEnum": "apps.projects.models.PROJECT_STATUS_CHOICES",
        "PayrollStatusEnum": "apps.payroll.models.PAYROLL_STATUS_CHOICES",
        "PayslipApprovalStatusEnum": "apps.finance.models.PAYSLIP_APPROVAL_STATUS_CHOICES",
        "RoleSlugEnum": "common.enums.ROLE_SLUG_CHOICES",
        # Employee.gender and LeaveType.restricted_to_gender share a choice set.
        "GenderEnum": "apps.employees.models.GENDER_CHOICES",
    },
}

# ---------------------------------------------------------------------------
# Microsoft Entra ID (company SSO)
# ---------------------------------------------------------------------------
ENTRA_TENANT_ID = env("ENTRA_TENANT_ID")
ENTRA_CLIENT_ID = env("ENTRA_CLIENT_ID")
ENTRA_AUDIENCE = env("ENTRA_AUDIENCE") or ENTRA_CLIENT_ID
ENTRA_AUTHORITY = "https://login.microsoftonline.com/" + ENTRA_TENANT_ID
ENTRA_JWKS_URI = ENTRA_AUTHORITY + "/discovery/v2.0/keys"
ENTRA_ISSUERS = (
    ENTRA_AUTHORITY + "/v2.0",
    "https://sts.windows.net/" + ENTRA_TENANT_ID + "/",
)
ENTRA_JWKS_CACHE_SECONDS = 60 * 60
# Microsoft owns the second factor: Conditional Access (or Security Defaults)
# prompts for it, and the exchange refuses any token whose `amr` claim does not
# say it happened. A policy with a gap then fails closed instead of quietly
# letting a password-only sign-in through.
ENTRA_REQUIRE_MFA = env.bool("ENTRA_REQUIRE_MFA", default=True)

# Once SSO is live, email/password sign-in is switched off for everyone except
# the break-glass accounts listed here - the way in when Entra itself is down.
PASSWORD_SIGN_IN_ENABLED = env.bool("PASSWORD_SIGN_IN_ENABLED", default=True)
PASSWORD_SIGN_IN_ALLOWED_EMAILS = frozenset(
    email.strip().lower()
    for email in env.list("PASSWORD_SIGN_IN_ALLOWED_EMAILS", default=[])
    if email.strip()
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
# Bearer tokens travel in a header; no cookie ever authenticates a request
# here. Allowing credentials would only widen what a misconfigured origin
# could do one day, for nothing today.
CORS_ALLOW_CREDENTIALS = False

# ---------------------------------------------------------------------------
# Email / notifications
# ---------------------------------------------------------------------------
# The SMTP credentials belong here, not in prod.py. They used to be
# production-only, which meant anyone who filled in EMAIL_HOST anywhere else
# got nothing at all: the console backend swallowed the message and the host
# was never read. Mail that quietly goes nowhere is the worst failure mode for
# a password reset, because the account's old password has already stopped
# working by then.
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)
# TLS and SSL are mutually exclusive in Django - implicit SSL is 465, STARTTLS
# is 587 - so the port default follows whichever was asked for.
EMAIL_USE_TLS = False if EMAIL_USE_SSL else env.bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=465 if EMAIL_USE_SSL else 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
# Without this a dead SMTP host holds the request thread open indefinitely.
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=10)

# Configuring a host *is* the intent to send, so it selects the SMTP backend on
# its own - nobody should have to remember to flip EMAIL_BACKEND as well. With
# no host, mail prints to the console, which is what local work wants.
EMAIL_BACKEND = env(
    "EMAIL_BACKEND",
    default=(
        "django.core.mail.backends.smtp.EmailBackend"
        if EMAIL_HOST
        else "django.core.mail.backends.console.EmailBackend"
    ),
)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@trigyan.io")
#: Where Django's own error mail comes from; without it that is "root@localhost",
#: which most relays reject.
SERVER_EMAIL = DEFAULT_FROM_EMAIL
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:5173")

# ---------------------------------------------------------------------------
# Logging - console locally, Azure Application Insights when configured
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {name} [{request_id}] {message}",
            "style": "{",
        },
    },
    "filters": {"request_id": {"()": "common.logging.RequestIDFilter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "filters": ["request_id"],
        },
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
        "empportal": {"handlers": ["console"], "level": "DEBUG", "propagate": False},
    },
}

APPLICATIONINSIGHTS_CONNECTION_STRING = env("APPLICATIONINSIGHTS_CONNECTION_STRING")
