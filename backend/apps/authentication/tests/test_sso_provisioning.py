"""Who an Entra ID token is allowed to become.

An account HR created ahead of somebody's first sign-in has no Entra id yet,
so the first SSO token has to find it by email. That fallback is the risk:
``preferred_username`` is mutable, and for a guest invited into the tenant it
is chosen by another organisation entirely. These pin that only a member of
our own tenant may claim an account by email, and only one that has never
been linked before.
"""

import pytest
from django.test import override_settings

from apps.authentication.services import AccountLinkRefused, provision_user_from_claims

TENANT = "11111111-2222-3333-4444-555555555555"
OTHER_TENANT = "99999999-8888-7777-6666-555555555555"


def claims(**overrides) -> dict:
    return {
        "oid": "aaaaaaaa-0000-0000-0000-000000000001",
        "tid": TENANT,
        "preferred_username": "priya.menon@trigyan.io",
        "name": "Priya Menon",
        **overrides,
    }


@pytest.fixture
def unlinked(django_user_model):
    """An account HR created, still waiting for its first SSO sign-in."""
    return django_user_model.objects.create_user(
        email="priya.menon@trigyan.io", password="Portal@123", first_name="Priya", last_name="Menon"
    )


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_a_member_of_our_tenant_claims_the_account_hr_made_for_them(unlinked):
    user = provision_user_from_claims(claims())

    assert user.pk == unlinked.pk
    unlinked.refresh_from_db()
    assert unlinked.entra_object_id == claims()["oid"]


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_a_guest_with_a_matching_username_is_refused(unlinked):
    # A guest's token still carries our tid - we issued it. What marks them
    # out is idp: the tenant they actually authenticated against. Email is
    # unique, so there is no second account to give them either.
    guest = claims(
        oid="bbbbbbbb-0000-0000-0000-000000000002",
        idp=f"https://sts.windows.net/{OTHER_TENANT}/",
    )

    with pytest.raises(AccountLinkRefused):
        provision_user_from_claims(guest)

    unlinked.refresh_from_db()
    assert not unlinked.entra_object_id, "the employee's account is untouched"


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_a_token_from_another_tenant_never_links_by_email(unlinked):
    with pytest.raises(AccountLinkRefused):
        provision_user_from_claims(
            claims(oid="cccccccc-0000-0000-0000-000000000003", tid=OTHER_TENANT)
        )

    unlinked.refresh_from_db()
    assert not unlinked.entra_object_id


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_an_account_already_linked_is_not_claimed_by_a_second_identity(unlinked):
    unlinked.entra_object_id = "dddddddd-0000-0000-0000-000000000004"
    unlinked.save(update_fields=["entra_object_id"])

    with pytest.raises(AccountLinkRefused):
        provision_user_from_claims(claims(oid="eeeeeeee-0000-0000-0000-000000000005"))

    unlinked.refresh_from_db()
    assert (
        unlinked.entra_object_id == "dddddddd-0000-0000-0000-000000000004"
    ), "one identity per account; the email match alone is not enough"


@pytest.mark.django_db
@override_settings(ENTRA_TENANT_ID=TENANT)
def test_the_linked_identity_is_found_by_its_id_thereafter(unlinked):
    first = provision_user_from_claims(claims())
    # The username changes - people marry, the directory is edited - and the
    # account follows the object id, not the address.
    again = provision_user_from_claims(claims(preferred_username="priya.sharma@trigyan.io"))

    assert first.pk == again.pk == unlinked.pk
