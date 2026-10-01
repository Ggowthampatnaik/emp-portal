"""Microsoft Entra ID token validation.

Two token types reach the API:

1. An **Entra ID access token** presented once by the SPA at
   ``POST /api/v1/auth/entra/exchange`` - validated here against the tenant JWKS
   and exchanged for a portal JWT.
2. A **portal JWT** (SimpleJWT) used for every subsequent request - handled by
   ``rest_framework_simplejwt``.

Validating Entra tokens on every request would mean a signature check against
cached JWKS plus no way to attach portal roles, hence the exchange step.
"""

import logging

import jwt
from django.conf import settings
from django.core.cache import cache
from jwt import PyJWKClient
from rest_framework import authentication, exceptions

logger = logging.getLogger("empportal.auth")

JWKS_CACHE_KEY = "entra:jwks-client"


class EntraTokenError(exceptions.AuthenticationFailed):
    pass


def _jwk_client() -> PyJWKClient:
    """PyJWKClient caches keys in-process; Redis carries it across workers."""
    client = cache.get(JWKS_CACHE_KEY)
    if client is None:
        client = PyJWKClient(settings.ENTRA_JWKS_URI, cache_keys=True)
        cache.set(JWKS_CACHE_KEY, client, settings.ENTRA_JWKS_CACHE_SECONDS)
    return client


def validate_entra_token(raw_token: str) -> dict:
    """Verifies signature, audience and issuer, returning the claim set."""
    if not settings.ENTRA_TENANT_ID or not settings.ENTRA_AUDIENCE:
        raise EntraTokenError("Entra ID is not configured on this environment.")

    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(raw_token)
        claims = jwt.decode(
            raw_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.ENTRA_AUDIENCE,
            issuer=list(settings.ENTRA_ISSUERS),
            options={"require": ["exp", "iat", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise EntraTokenError("The Entra ID token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        logger.warning("Rejected Entra ID token: %s", exc)
        raise EntraTokenError("The Entra ID token is invalid.") from exc

    if not claims.get("oid"):
        raise EntraTokenError("The Entra ID token is missing the oid claim.")
    return claims


class EntraIDJWTAuthentication(authentication.BaseAuthentication):
    """Accepts an Entra ID access token on the exchange endpoint only.

    Views opt in by setting ``entra_token_exchange = True``; everywhere else this
    class stands down so SimpleJWT handles the portal token.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        if not getattr(request, "parser_context", None):
            return None
        view = request.parser_context.get("view")
        if not getattr(view, "entra_token_exchange", False):
            return None

        header = authentication.get_authorization_header(request).split()
        if not header or header[0].decode().lower() != self.keyword.lower():
            return None
        if len(header) != 2:
            raise EntraTokenError("Malformed Authorization header.")

        claims = validate_entra_token(header[1].decode())
        request.entra_claims = claims
        return None  # the view provisions/loads the user from the claims

    def authenticate_header(self, request) -> str:
        return self.keyword
