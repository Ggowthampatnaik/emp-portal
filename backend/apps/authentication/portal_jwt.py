"""Portal JWT authentication, with the two checks SimpleJWT cannot make itself.

**Token version.** There is no token blacklist in this deployment, so replacing
somebody's credential has to invalidate their existing sessions some other way:
every token carries the account's ``tv`` (token version) and it is compared on
each request. Bump ``User.token_version`` and every token minted before that
moment stops working, instantly and everywhere.

Bumping is deliberate and narrow - it happens when a credential is replaced by
*somebody else* (a forgotten-password reset, an administrator issuing a
temporary password), not when the signed-in user changes their own password.
Changing your own password should not log you out of the tab you are typing in.
"""

from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

from common.profile_gate import MESSAGE as PROFILE_GATE_MESSAGE
from common.profile_gate import PASSWORD_MESSAGE, may_proceed, must_change_password_first

TOKEN_VERSION_CLAIM = "tv"


class PortalJWTAuthentication(JWTAuthentication):
    """SimpleJWT, plus the two checks the framework cannot make for us.

    The Complete Profile gate lives here rather than in a permission class
    because almost every viewset declares its own ``permission_classes``, and a
    declared list replaces the default - so a default permission would apply to
    almost nothing. See ``common/profile_gate.py``.
    """

    def authenticate(self, request):
        # The SSO exchange carries an *Entra* token in the same Bearer header.
        # SimpleJWT would try to validate it as a portal token and raise, and a
        # raised authenticator ends the request - so a genuine Entra token got
        # a 401 and the exchange endpoint could never be reached. Stand down
        # there, exactly as EntraIDJWTAuthentication stands down everywhere
        # else.
        view = (getattr(request, "parser_context", None) or {}).get("view")
        if getattr(view, "entra_token_exchange", False):
            return None

        result = super().authenticate(request)
        if result is None:
            return None

        user, token = result
        # Order matters: a new joiner has both gates shut, and the password
        # comes first because the wizard behind the second needs a session
        # that is theirs.
        if must_change_password_first(user, request):
            raise PermissionDenied(PASSWORD_MESSAGE)
        if not may_proceed(user, request):
            raise PermissionDenied(PROFILE_GATE_MESSAGE)
        return user, token

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        presented = validated_token.get(TOKEN_VERSION_CLAIM)
        if presented is None:
            # A token minted before versioning existed. Treated as version 0,
            # so upgrading the portal does not sign everybody out.
            presented = 0

        if int(presented) != user.token_version:
            raise AuthenticationFailed(
                "This session ended when the account password was reset. Sign in again.",
                code="token_superseded",
            )
        return user
