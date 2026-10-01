"""Authentication endpoints: password sign-in, SSO exchange, refresh, me, logout."""

import logging

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from apps.authentication import lockout
from apps.authentication.reset import request_password_reset, use_temporary_password
from apps.authentication.serializers import (
    CurrentUserSerializer,
    EntraExchangeResponseSerializer,
    LoginSerializer,
    LogoutSerializer,
    PasswordChangeSerializer,
    PasswordForgotSerializer,
    TokenPairSerializer,
)
from apps.authentication.services import AccountLinkRefused, provision_user_from_claims
from common.audit import record_audit
from common.enums import AuditAction
from common.request_context import get_request_id

logger = logging.getLogger("empportal.auth")

INVALID_CREDENTIALS = "The email address or password is incorrect."
PASSWORD_SIGN_IN_DISABLED = "Sign in with your Microsoft work account."
MFA_REQUIRED = (
    "Your Microsoft sign-in did not use multi-factor authentication. "
    "Set up the Microsoft Authenticator app, or contact IT support."
)

#: `amr` values that mean Entra ID checked a second factor. `ngcmfa` is what a
#: Windows Hello or passkey sign-in reports instead of plain `mfa`.
MFA_METHODS = frozenset({"mfa", "ngcmfa"})


def password_sign_in_allowed(email: str) -> bool:
    """True unless password sign-in is off and this is not a break-glass account."""
    if settings.PASSWORD_SIGN_IN_ENABLED:
        return True
    return email.strip().lower() in settings.PASSWORD_SIGN_IN_ALLOWED_EMAILS


def used_mfa(claims: dict) -> bool:
    return bool(MFA_METHODS.intersection(claims.get("amr") or []))


def issue_token_pair(user) -> dict[str, str]:
    """Mints the portal JWT pair, embedding roles so the SPA can gate routes.

    ``tv`` is the account's token version. Replacing someone's credential bumps
    it, which is what makes every session they already had stop working - there
    is no token blacklist in this deployment, and a claim compared on each
    request costs nothing.
    """
    refresh = RefreshToken.for_user(user)
    refresh["email"] = user.email
    refresh["roles"] = sorted(user.role_slugs)
    refresh["tv"] = user.token_version
    return {"refresh": str(refresh), "access": str(refresh.access_token)}


class LoginView(APIView):
    """``POST /api/v1/auth/login`` - email and password.

    Used for local accounts. Company SSO goes through the Entra ID exchange
    endpoint instead; both return the same portal JWT pair.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses={200: TokenPairSerializer})
    def post(self, request: Request) -> Response:
        # Refused before anything is looked up or counted: with SSO live there
        # is no password to guess, so a guess must not feed the lockout either.
        if not password_sign_in_allowed(str(request.data.get("email", ""))):
            return Response(
                {
                    "error": {
                        "code": "password_sign_in_disabled",
                        "message": PASSWORD_SIGN_IN_DISABLED,
                        "details": {"credentials": [PASSWORD_SIGN_IN_DISABLED]},
                        "request_id": get_request_id(),
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Looked up before the password is checked, so a locked account is
        # refused without the guess even being evaluated - and so a correct
        # password found during a lock does not end it early.
        account = lockout.find_user(str(request.data.get("email", "")))
        until = lockout.locked_until(account)
        if until is not None:
            minutes = lockout.remaining_minutes(until)
            message = (
                f"Too many failed sign-in attempts. Try again in {minutes} "
                f"minute{'s' if minutes != 1 else ''}, or reset your password."
            )
            logger.warning("Sign-in refused for locked account %s", account.email)
            record_audit(
                request,
                AuditAction.LOCKED_OUT,
                account,
                actor=None,
                changes={"email": account.email, "until": until.isoformat()},
            )
            return Response(
                {
                    "error": {
                        "code": "account_locked",
                        "message": message,
                        "details": {"credentials": [message]},
                        "request_id": get_request_id(),
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            # Malformed payloads report per field; a credential failure always
            # reports the same message, whatever the underlying cause.
            #
            # The one exception is a temporary password that has expired or
            # already been used. Saying so reveals nothing - the caller has just
            # demonstrated they had the mailbox it was sent to - and not saying
            # so leaves them retyping a password that will never work again.
            credentials = serializer.errors.get("credentials") or []
            if credentials and getattr(credentials[0], "code", "") == (
                "expired_temporary_password"
            ):
                message = str(credentials[0])
                return Response(
                    {
                        "error": {
                            "code": "expired_temporary_password",
                            "message": message,
                            "details": {"credentials": [message]},
                            "request_id": get_request_id(),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if "credentials" in serializer.errors:
                # A wrong password, counted against the account. Nothing is
                # *locked* for an address with no account - there would be
                # nothing to lock, and those rows would themselves be a list
                # of who works here. The audit line is written either way: a
                # run of attempts against addresses that do not exist is the
                # clearest signal there is.
                lockout.register_failure(account)
                record_audit(
                    request,
                    AuditAction.LOGIN_FAILED,
                    account,
                    actor=None,
                    changes={"email": str(request.data.get("email", ""))[:150]},
                )
                return Response(
                    {
                        "error": {
                            "code": "invalid_credentials",
                            "message": INVALID_CREDENTIALS,
                            "details": {"credentials": [INVALID_CREDENTIALS]},
                            "request_id": get_request_id(),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raise DRFValidationError(serializer.errors)

        user = serializer.validated_data["user"]
        if serializer.validated_data.get("temporary"):
            # This is the moment the reset happens: the temporary password is
            # spent, becomes the account password, and ends the old sessions.
            # The token pair minted below carries the new version.
            use_temporary_password(user, request.data.get("password", ""))
        # The run of failures ends here rather than expiring on its own: nine
        # typos followed by the right password is not an attack.
        lockout.clear(user)
        user.touch_login()
        record_audit(request, AuditAction.LOGIN, user, actor=user)
        logger.info("Password sign-in for %s", user.email)

        return Response(
            {
                **issue_token_pair(user),
                "user": CurrentUserSerializer(user, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )


class PasswordForgotView(APIView):
    """``POST /api/v1/auth/password/forgot`` - emails a temporary password.

    Always answers 204, whatever the address. Telling an unauthenticated caller
    whether an account exists hands them half of a credential-stuffing list,
    and "no such user" is exactly the message people expect, which is why it
    has to be resisted deliberately.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "login"

    @extend_schema(
        request=PasswordForgotSerializer,
        responses={204: None},
        description=(
            "Sends a temporary password to the address if it belongs to an "
            "active account. Answers 204 either way."
        ),
    )
    def post(self, request: Request) -> Response:
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Still 204: a different answer would reveal which addresses are the
        # break-glass accounts.
        if not password_sign_in_allowed(serializer.validated_data["email"]):
            return Response(status=status.HTTP_204_NO_CONTENT)

        sent = request_password_reset(
            serializer.validated_data["email"],
            ip=request.META.get("REMOTE_ADDR", ""),
        )
        if sent:
            logger.info("Password reset queued for delivery")
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordChangeView(APIView):
    """``POST /api/v1/auth/password/change`` - signed-in user changes own password."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        record_audit(request, AuditAction.UPDATE, request.user, changes={"password": "changed"})
        return Response(status=status.HTTP_204_NO_CONTENT)


class EntraTokenExchangeView(APIView):
    """``POST /api/v1/auth/entra/exchange``

    The SPA acquires an Entra ID access token via MSAL and posts it here as a
    Bearer token. On success the account is provisioned/updated and a portal JWT
    pair is returned.
    """

    permission_classes = [AllowAny]
    throttle_scope = "login"
    entra_token_exchange = True  # tells EntraIDJWTAuthentication to validate

    @extend_schema(
        request=None,
        responses={200: EntraExchangeResponseSerializer},
        auth=[{"BearerEntraID": []}],
        description="Exchange a Microsoft Entra ID access token for a portal JWT pair.",
    )
    def post(self, request: Request) -> Response:
        claims = getattr(request, "entra_claims", None)
        if claims is None:
            return Response(
                {
                    "error": {
                        "code": "not_authenticated",
                        "message": "An Entra ID bearer token is required.",
                    }
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Checked before provisioning, so a password-only token cannot even
        # create or link an account.
        if settings.ENTRA_REQUIRE_MFA and not used_mfa(claims):
            logger.warning(
                "Refused Entra identity %s: no MFA in amr=%s", claims.get("oid"), claims.get("amr")
            )
            return Response(
                {"error": {"code": "mfa_required", "message": MFA_REQUIRED}},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            user = provision_user_from_claims(claims)
        except AccountLinkRefused as refused:
            return Response(
                {"error": {"code": "account_link_refused", "message": str(refused)}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not user.is_active:
            return Response(
                {
                    "error": {
                        "code": "account_disabled",
                        "message": "This account has been deactivated.",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # A locked account is locked everywhere. The lock is raised by password
        # guessing, and an Entra token is proof that guessing cannot forge - but
        # ten failures against an account is a reason to hold it, not a reason
        # to hold one door and leave the other open.
        until = lockout.locked_until(user)
        if until is not None:
            minutes = lockout.remaining_minutes(until)
            return Response(
                {
                    "error": {
                        "code": "account_locked",
                        "message": (
                            "This account is locked after repeated failed sign-ins. "
                            f"Try again in {minutes} minute{'s' if minutes != 1 else ''}."
                        ),
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if user.must_change_password:
            # HR's temporary password was only ever a way in until this first
            # Microsoft sign-in. Asking the person to replace it would give them
            # a second credential nobody needs, so it is retired instead - and
            # the plain-text original stops working with it.
            user.set_unusable_password()
            user.must_change_password = False
            user.save(update_fields=["password", "must_change_password", "updated_at"])

        user.touch_login()
        record_audit(request, AuditAction.LOGIN, user, actor=user)
        logger.info("SSO exchange succeeded for %s", user.email)
        return Response(
            {
                **issue_token_pair(user),
                "user": CurrentUserSerializer(user, context={"request": request}).data,
            },
            status=status.HTTP_200_OK,
        )


class PortalTokenRefreshView(TokenRefreshView):
    """``POST /api/v1/auth/token/refresh``"""

    permission_classes = [AllowAny]
    throttle_scope = "login"


class CurrentUserView(APIView):
    """``GET /api/v1/auth/me`` - identity, roles and permission codes."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: CurrentUserSerializer})
    def get(self, request: Request) -> Response:
        return Response(CurrentUserSerializer(request.user, context={"request": request}).data)


class LogoutView(APIView):
    """``POST /api/v1/auth/logout`` - retires the session's refresh token.

    Clearing the browser's copy is not signing out. Anything that already has
    the refresh token - a proxy log, a copied storage entry, a shared machine -
    can keep minting access tokens from it for the rest of its seven days. So
    the token is blacklisted here, which ends that session and no other: the
    same person stays signed in on their phone, which is what they expect.

    It answers 204 whatever happens. A sign-out that fails leaves somebody
    looking at a portal they have asked to leave, and every outcome that could
    fail here - no token sent, a token already retired, a malformed one - has
    the same remedy as success, which is that the browser drops its copy.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(request=LogoutSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        presented = str(request.data.get("refresh") or "").strip()
        revoked = False
        if presented:
            try:
                RefreshToken(presented).blacklist()
                revoked = True
            except TokenError:
                # Expired, already blacklisted, or not ours. Nothing to do:
                # the token cannot be used either way.
                logger.info("Logout presented a refresh token that was already dead")

        record_audit(request, AuditAction.LOGOUT, request.user, changes={"token_revoked": revoked})
        logger.info("Logout for %s (token revoked: %s)", request.user.email, revoked)
        return Response(status=status.HTTP_204_NO_CONTENT)
