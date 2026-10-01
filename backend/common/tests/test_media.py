"""Uploaded files open with a signature, not with a guessed path.

`static()` used to serve MEDIA_ROOT to anyone who asked. Uploads keep the name
they were given and those names are formulaic - ``TRG0002-bachelors.pdf`` - so
a degree certificate was one guessed path away from a stranger with no account.

The links the API hands out are signed now, and the view checks the signature.
That is the same shape production has always had, where Blob Storage serves the
files behind a SAS token: the link is the credential, which is what lets an
``<img>`` tag and a download link keep working without an Authorization header.
"""

import time

import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.signing import BadSignature
from django.test import override_settings
from django.urls import Resolver404, URLResolver, clear_url_caches
from django.urls.resolvers import RegexPattern

from common.media import media_url, sign_media_path, verified_media_path

PATH = "employee-documents/2026/09/TRG0002-bachelors.pdf"


@pytest.fixture
def stored_file():
    name = default_storage.save(PATH, ContentFile(b"%PDF-1.4 a certificate"))
    yield name
    default_storage.delete(name)


# ---------------------------------------------------------------------------
# The signature itself
# ---------------------------------------------------------------------------
def test_a_signed_path_reads_back():
    assert verified_media_path(sign_media_path(PATH)) == PATH


@pytest.mark.parametrize(
    "token",
    [
        pytest.param("", id="no token at all"),
        pytest.param("not-a-token", id="invented"),
        pytest.param(sign_media_path(PATH)[:-4] + "aaaa", id="edited"),
    ],
)
def test_anything_but_a_real_signature_is_refused(token):
    with pytest.raises(BadSignature):
        verified_media_path(token)


def test_a_signature_for_one_file_does_not_open_another():
    """The path is inside the signature, not merely alongside it."""
    token = sign_media_path("employee-photos/2026/09/TRG0002.png")

    assert verified_media_path(token) != PATH


def test_a_signature_expires(monkeypatch):
    token = sign_media_path(PATH)
    # Nine hours later; links are good for eight. The real clock is captured
    # first, or the replacement calls itself.
    nine_hours_on = time.time() + 9 * 60 * 60
    monkeypatch.setattr(time, "time", lambda: nine_hours_on)

    with pytest.raises(BadSignature):
        verified_media_path(token)


# ---------------------------------------------------------------------------
# What the API hands out
# ---------------------------------------------------------------------------
@override_settings(MEDIA_SIGNING=True)
def test_the_api_signs_the_links_it_gives_out(stored_file):
    url = media_url(None, _field(stored_file))

    assert "?t=" in url
    assert verified_media_path(url.split("?t=")[1]) == stored_file


@override_settings(MEDIA_SIGNING=False)
def test_a_storage_that_signs_its_own_urls_is_left_alone(stored_file):
    """Azure hands out a SAS URL that is already signed; appending to its
    query string would break the signature it made."""
    url = media_url(None, _field(stored_file))

    assert "?t=" not in url


def test_no_file_means_no_link():
    assert media_url(None, None) is None


class _Field:
    """The two attributes `media_url` reads off a FileField."""

    def __init__(self, name):
        self.name = name
        self.url = f"/media/{name}"

    def __bool__(self):
        return True


def _field(name):
    return _Field(name)


# ---------------------------------------------------------------------------
# The view, as the router would reach it
# ---------------------------------------------------------------------------
def media_routes():
    """The url table as it is built with DEBUG on, where media is routed."""
    import importlib

    import config.urls

    with override_settings(DEBUG=True):
        clear_url_caches()
        patterns = list(importlib.reload(config.urls).urlpatterns)
    clear_url_caches()
    importlib.reload(config.urls)
    return patterns


def fetch(patterns, path, token=None):
    from django.test import RequestFactory

    request = RequestFactory().get(f"/media/{path}", {"t": token} if token else {})
    resolver = URLResolver(RegexPattern(r"^/"), patterns)
    match = resolver.resolve(f"/media/{path}")
    return match.func(request, *match.args, **match.kwargs)


@pytest.mark.django_db
def test_the_file_is_served_to_a_signed_link(stored_file):
    response = fetch(media_routes(), stored_file, sign_media_path(stored_file))

    assert response.status_code == 200
    assert b"certificate" in b"".join(response.streaming_content)


@pytest.mark.django_db
def test_a_guessed_path_alone_opens_nothing(stored_file):
    from django.http import Http404

    # Exactly what an outsider has: the name, and nothing else.
    with pytest.raises(Http404):
        fetch(media_routes(), stored_file)


@pytest.mark.django_db
def test_a_signature_for_a_file_that_is_gone_is_still_a_404():
    from django.http import Http404

    with pytest.raises(Http404):
        fetch(media_routes(), PATH, sign_media_path(PATH))


def test_media_is_not_routed_at_all_without_debug():
    """Production serves uploads from Blob Storage; Django serves none of it."""
    import importlib

    import config.urls

    clear_url_caches()
    patterns = list(importlib.reload(config.urls).urlpatterns)
    resolver = URLResolver(RegexPattern(r"^/"), patterns)

    with pytest.raises(Resolver404):
        resolver.resolve(f"/media/{PATH}")
