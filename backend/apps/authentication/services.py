"""User provisioning from Entra ID claims (just-in-time onboarding)."""

import logging

from django.conf import settings
from django.db import transaction

from apps.authentication.models import Role, User
from common.enums import RoleSlug

logger = logging.getLogger("empportal.auth")


def _names_from_claims(claims: dict) -> tuple[str, str]:
    given = claims.get("given_name") or ""
    family = claims.get("family_name") or ""
    if given or family:
        return given, family
    display = claims.get("name") or ""
    parts = display.split(" ", 1)
    return (parts[0] if parts else ""), (parts[1] if len(parts) > 1 else "")


class AccountLinkRefused(Exception):
    """An Entra identity that must not become the account its email names."""


def _is_home_tenant_member(claims: dict) -> bool:
    """A member of our tenant, not a guest invited into it.

    A guest's token carries our ``tid`` too - that is the tenant that issued
    it - so the tenant alone proves nothing. What marks a guest is ``idp``,
    the tenant they actually authenticated against: absent for members, and
    for a guest the other organisation's issuer.
    """
    if claims.get("tid") != settings.ENTRA_TENANT_ID:
        return False
    idp = claims.get("idp")
    return not idp or settings.ENTRA_TENANT_ID in str(idp)


@transaction.atomic
def provision_user_from_claims(claims: dict) -> User:
    """Finds or creates the portal account behind a validated Entra ID token.

    First sign-in creates the account with the base EMPLOYEE role; HR/Admin
    then complete the employee profile and grant any additional roles.
    """
    object_id = claims["oid"]
    email = (claims.get("preferred_username") or claims.get("email") or "").lower()
    upn = claims.get("upn") or claims.get("preferred_username") or ""
    first_name, last_name = _names_from_claims(claims)

    user = User.objects.filter(entra_object_id=object_id).first()
    if user is None and email:
        # An account HR created before this person's first SSO sign-in, still
        # waiting for its Entra id. Only a member of our own tenant may claim
        # one by email: `preferred_username` is mutable and, for a guest, is
        # chosen by another organisation entirely. Email is unique here, so an
        # identity that may not claim the account cannot be given one either -
        # it is refused, and the employee's account is left exactly as it was.
        by_email = User.objects.filter(email=email).first()
        if by_email is not None:
            if by_email.entra_object_id:
                logger.warning(
                    "Refused Entra identity %s: %s is already linked to another identity",
                    object_id,
                    email,
                )
                raise AccountLinkRefused("This email address is linked to a different sign-in.")
            if not _is_home_tenant_member(claims):
                logger.warning(
                    "Refused Entra identity %s: guest or foreign tenant claiming %s",
                    object_id,
                    email,
                )
                raise AccountLinkRefused("Guest accounts cannot sign in to the portal.")
            logger.warning("Linking Entra identity %s to existing account by email", object_id)
            user = by_email

    if user is None:
        if not email:
            raise ValueError("Entra ID token carries no email address.")
        user = User.objects.create_user(
            email=email,
            first_name=first_name,
            last_name=last_name,
            entra_object_id=object_id,
            entra_upn=upn,
        )
        employee_role = Role.objects.filter(slug=RoleSlug.EMPLOYEE).first()
        if employee_role:
            user.user_roles.create(role=employee_role)
        logger.info("Provisioned new user %s from Entra ID", user.email)
        return user

    updates: list[str] = []
    for field, value in (
        ("entra_object_id", object_id),
        ("entra_upn", upn),
        ("first_name", first_name),
        ("last_name", last_name),
    ):
        if value and getattr(user, field) != value:
            setattr(user, field, value)
            updates.append(field)
    if updates:
        user.save(update_fields=[*updates, "updated_at"])
    return user
