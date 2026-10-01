"""Links to uploaded files that carry their own permission.

In production the files live in Azure Blob Storage and every link the API hands
out is a SAS URL: signed, and good for an hour. Locally Django serves the same
files itself, and it used to serve them to anyone who asked - uploads keep the
name they were given, and those names are formulaic (``TRG0002-bachelors.pdf``),
so a degree certificate was one guessed path away from being downloaded by
somebody with no account at all.

This gives the local files the same shape as the deployed ones. The API signs
the path it hands out, the view checks the signature, and a path on its own
opens nothing. The signature is the credential, exactly as it is with a SAS
URL - which is what lets an ``<img>`` tag and a download link keep working,
since neither can send an Authorization header.
"""

from django.conf import settings
from django.core.signing import TimestampSigner

#: How long a handed-out link stays good. Long enough that a profile page left
#: open over lunch still shows its photographs, short enough that a URL copied
#: out of a browser history is not a lasting key.
MEDIA_LINK_SECONDS = 8 * 60 * 60

_signer = TimestampSigner(salt="empportal.media")


def sign_media_path(name: str) -> str:
    """The token that makes ``name`` fetchable."""
    return _signer.sign(name)


def verified_media_path(token: str) -> str:
    """The path a token vouches for. Raises ``BadSignature`` if it does not."""
    return _signer.unsign(token, max_age=MEDIA_LINK_SECONDS)


def media_url(request, filefield) -> str | None:
    """An absolute, signed URL for an uploaded file - or None if there is none.

    Every serializer that exposes a photo or a document goes through here, so
    there is one answer to "what does a link to an upload look like" rather
    than a dozen.
    """
    if not filefield:
        return None

    url = filefield.url
    # Only when Django is the one serving the file. A storage backend that
    # signs its own URLs (Azure, S3) has already answered this question, and
    # appending to its query string would break the signature it made.
    if getattr(settings, "MEDIA_SIGNING", False):
        url = f"{url}?t={sign_media_path(filefield.name)}"

    return request.build_absolute_uri(url) if request else url
