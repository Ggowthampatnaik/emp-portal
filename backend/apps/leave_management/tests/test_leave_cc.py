"""Copying people in on a leave request (F8).

The rule that matters most is the one that is easy to get wrong by accident:
being copied in is **information, not access**. A CC recipient learns that the
request exists; they do not gain the ability to see it in the API, and they
certainly do not gain the ability to decide on it.
"""

from datetime import timedelta

import pytest

from apps.leave_management.models import LeaveRequestCC
from apps.leave_management.services import add_cc_recipients, apply_for_leave
from apps.notifications.models import Notification

SEARCH = "/api/v1/employees/search/"


def cc_emails(request) -> set[str]:
    return set(
        LeaveRequestCC.objects.filter(leave_request=request).values_list("user__email", flat=True)
    )


# ---------------------------------------------------------------------------
# Copying people in
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_request_can_copy_in_colleagues(org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["peer"].user_id, org["outsider"].user_id],
    )

    assert cc_emails(request) == {org["peer"].email, org["outsider"].email}


@pytest.mark.django_db
def test_every_cc_recipient_is_notified_once(org, leave_type, next_monday):
    apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["peer"].user_id, org["outsider"].user_id],
    )

    for person in (org["peer"], org["outsider"]):
        notes = Notification.objects.filter(recipient=person.user, title__contains="Copied on")
        assert notes.count() == 1, f"{person.employee_code} should be told exactly once"
        assert "no action is needed" in notes.first().message


@pytest.mark.django_db
def test_the_same_person_twice_is_copied_in_once(org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["peer"].user_id, org["peer"].user_id],
    )

    assert LeaveRequestCC.objects.filter(leave_request=request).count() == 1
    assert Notification.objects.filter(recipient=org["peer"].user).count() == 1


@pytest.mark.django_db
def test_copying_in_again_does_not_notify_again(org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["peer"].user_id],
    )

    add_cc_recipients(request, [org["peer"].user_id])

    assert Notification.objects.filter(recipient=org["peer"].user).count() == 1


@pytest.mark.django_db
def test_the_applicant_is_never_cc_themselves(org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["employee"].user_id, org["peer"].user_id],
    )

    assert cc_emails(request) == {org["peer"].email}


@pytest.mark.django_db
def test_the_approving_manager_is_not_cc_twice(org, leave_type, next_monday):
    """They already get the approval request; a CC would be a second copy."""
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["manager"].user_id],
    )

    assert cc_emails(request) == set()
    assert Notification.objects.filter(recipient=org["manager"].user).count() == 1


@pytest.mark.django_db
def test_an_inactive_account_is_skipped(org, leave_type, next_monday):
    leaver = org["outsider"].user
    leaver.is_active = False
    leaver.save(update_fields=["is_active"])

    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[leaver.pk, org["peer"].user_id],
    )

    assert cc_emails(request) == {org["peer"].email}


@pytest.mark.django_db
def test_no_cc_is_a_perfectly_normal_request(org, leave_type, next_monday):
    request = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Day off.")
    assert cc_emails(request) == set()


# ---------------------------------------------------------------------------
# CC is not access
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_being_copied_in_grants_no_visibility(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["outsider"].user_id],
    )

    client = auth_client(org["outsider"])
    assert client.get(f"/api/v1/leaves/{request.pk}/").status_code in (403, 404)
    assert client.get("/api/v1/leaves/").data["count"] == 0


@pytest.mark.django_db
def test_being_copied_in_grants_no_say(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["outsider"].user_id],
    )

    response = auth_client(org["outsider"]).post(f"/api/v1/leaves/{request.pk}/approve/", {})
    assert response.status_code in (403, 404)


# ---------------------------------------------------------------------------
# Through the API
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_applying_with_cc_through_the_api(auth_client, org, leave_type, next_monday):
    response = auth_client(org["employee"]).post(
        "/api/v1/leaves/",
        {
            "leave_type": leave_type.pk,
            "start_date": next_monday.isoformat(),
            "end_date": next_monday.isoformat(),
            "reason": "Personal errand.",
            "cc_user_ids": [org["peer"].user_id],
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert [row["email"] for row in response.data["cc_recipients"]] == [org["peer"].email]
    assert response.data["cc_recipients"][0]["notified_at"] is not None


@pytest.mark.django_db
def test_the_applicant_sees_who_was_copied_in(auth_client, org, leave_type, next_monday):
    request = apply_for_leave(
        org["employee"],
        leave_type,
        next_monday,
        next_monday,
        "Day off.",
        cc_user_ids=[org["peer"].user_id],
    )

    response = auth_client(org["employee"]).get(f"/api/v1/leaves/{request.pk}/")
    row = response.data["cc_recipients"][0]
    assert row["user_name"] == org["peer"].full_name
    assert row["employee_code"] == "TRG0006"


# ---------------------------------------------------------------------------
# The people picker behind it
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_search_matches_a_first_name_prefix(auth_client, org):
    response = auth_client(org["employee"]).get(SEARCH, {"q": "kar"})

    assert response.status_code == 200
    assert [row["employee_code"] for row in response.data] == ["TRG0006"]


@pytest.mark.django_db
def test_the_search_matches_a_last_name_prefix(auth_client, org):
    response = auth_client(org["employee"]).get(SEARCH, {"q": "men"})
    assert [row["employee_code"] for row in response.data] == ["TRG0002"]


@pytest.mark.django_db
def test_the_search_is_a_prefix_not_a_contains(auth_client, org):
    """ "eddy" is inside "Reddy" but is not how anyone starts typing a name."""
    response = auth_client(org["employee"]).get(SEARCH, {"q": "eddy"})
    assert response.data == []


@pytest.mark.django_db
def test_the_search_matches_an_employee_code(auth_client, org):
    response = auth_client(org["employee"]).get(SEARCH, {"q": "TRG0006"})
    assert [row["employee_code"] for row in response.data] == ["TRG0006"]


@pytest.mark.django_db
def test_the_search_carries_the_user_id_the_cc_field_needs(auth_client, org):
    response = auth_client(org["employee"]).get(SEARCH, {"q": "kar"})

    row = response.data[0]
    assert row["user_id"] == org["peer"].user_id
    assert row["id"] == org["peer"].pk, "both ids, and they are different things"
    assert "full_name" in row and "photo_url" in row


@pytest.mark.django_db
def test_a_single_character_returns_nothing(auth_client, org):
    """Below two characters the answer is the whole company, which helps nobody."""
    assert auth_client(org["employee"]).get(SEARCH, {"q": "a"}).data == []


@pytest.mark.django_db
def test_people_who_have_left_are_not_offered(auth_client, org):
    from common.enums import EmploymentStatus

    leaver = org["peer"]
    leaver.employment_status = EmploymentStatus.INACTIVE
    leaver.save(update_fields=["employment_status"])

    assert auth_client(org["employee"]).get(SEARCH, {"q": "kar"}).data == []


@pytest.mark.django_db
def test_the_search_needs_a_signed_in_user(api_client, org):
    assert api_client.get(SEARCH, {"q": "kar"}).status_code == 401


@pytest.mark.django_db
def test_cc_is_capped_so_a_request_cannot_notify_everyone(
    auth_client, org, leave_type, next_monday
):
    response = auth_client(org["employee"]).post(
        "/api/v1/leaves/",
        {
            "leave_type": leave_type.pk,
            "start_date": next_monday.isoformat(),
            "end_date": (next_monday + timedelta(days=1)).isoformat(),
            "reason": "Personal errand.",
            "cc_user_ids": list(range(1, 20)),
        },
        format="json",
    )

    assert response.status_code == 400
    assert "cc_user_ids" in response.data["error"]["details"]
