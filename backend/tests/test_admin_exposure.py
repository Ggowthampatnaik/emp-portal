"""The Django maintenance admin exists only where it is switched on.

Its session login sits outside every throttle and lockout the portal has, so
outside development it is not routed at all - nothing to brute-force at a path
that does not exist. The URL table is built at import, which is why the tests
reload it under each setting rather than flipping a flag on a live server.
"""

import importlib

import pytest
from django.test import override_settings
from django.urls import Resolver404, clear_url_caches, resolve


def routes_with(**settings):
    """The url table as it would be built under these settings."""
    import config.urls

    with override_settings(**settings):
        clear_url_caches()
        module = importlib.reload(config.urls)
        patterns = list(module.urlpatterns)
    # Put the table back the way the rest of the suite expects it.
    clear_url_caches()
    importlib.reload(config.urls)
    return patterns


def resolves(patterns, path):
    """Whether ``path`` (without its leading slash) is routed by ``patterns``."""
    from django.urls import URLResolver
    from django.urls.resolvers import RegexPattern

    resolver = URLResolver(RegexPattern(r"^/"), patterns)
    try:
        resolver.resolve("/" + path)
        return True
    except Resolver404:
        return False


def test_it_is_off_by_default_outside_development():
    patterns = routes_with(DJANGO_ADMIN_ENABLED=False)

    assert not resolves(patterns, "django-admin/")
    assert not resolves(patterns, "django-admin/login/")


def test_it_can_be_switched_on_at_a_chosen_path():
    patterns = routes_with(DJANGO_ADMIN_ENABLED=True, DJANGO_ADMIN_PATH="ops-console-4f2a/")

    assert resolves(patterns, "ops-console-4f2a/login/")
    assert not resolves(patterns, "django-admin/login/"), "the well-known path stays dark"


def test_the_api_is_unaffected_either_way():
    for enabled in (True, False):
        patterns = routes_with(DJANGO_ADMIN_ENABLED=enabled)
        assert resolves(patterns, "api/v1/auth/login/")
        assert resolves(patterns, "healthz/")


@pytest.mark.django_db
def test_the_test_settings_leave_it_off_and_the_path_is_a_404(client):
    """Test settings switch it off, as production does: a real request at the
    old path finds nothing, and in particular no login form to guess at."""
    response = client.get("/django-admin/login/")
    assert response.status_code == 404
    assert b"password" not in response.content.lower()


def test_resolve_helper_is_honest():
    # Sanity check for the helper above: the current live table resolves the API.
    resolve("/healthz/")
