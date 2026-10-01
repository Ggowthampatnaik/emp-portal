"""drf-spectacular extensions so the OpenAPI document describes SSO correctly."""

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class EntraIDAuthenticationScheme(OpenApiAuthenticationExtension):
    """Documents the Entra ID bearer token accepted by the exchange endpoint."""

    target_class = "apps.authentication.authentication.EntraIDJWTAuthentication"
    name = "BearerEntraID"

    def get_security_definition(self, auto_schema) -> dict:
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": (
                "Microsoft Entra ID access token acquired by the SPA via MSAL. "
                "Accepted only by /api/v1/auth/entra/exchange/, which returns the "
                "portal JWT pair used for every other endpoint."
            ),
        }


class PortalJWTAuthenticationScheme(OpenApiAuthenticationExtension):
    """Documents the portal JWT used by every endpoint after sign-in.

    It is SimpleJWT's bearer token; the subclass only adds the token-version
    check and the Complete Profile gate, neither of which changes the shape of
    the header.
    """

    target_class = "apps.authentication.portal_jwt.PortalJWTAuthentication"
    name = "BearerPortalJWT"

    def get_security_definition(self, auto_schema) -> dict:
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": (
                "Portal JWT issued by /api/v1/auth/login/ or the Entra ID exchange. "
                "Carries the account's roles and its token version - a password "
                "reset bumps the version and retires every token issued before it."
            ),
        }
