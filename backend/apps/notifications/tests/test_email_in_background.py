"""A slow mail server must not be able to hold up whatever raised the notification."""

from unittest import mock

import pytest
from django.core import mail
from django.db import transaction

from apps.leave_management.models import LeaveBalance
from apps.leave_management.services import apply_for_leave
from apps.notifications import services
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.notifications.tasks import send_notification_email
from common.enums import LeaveStatus


@pytest.fixture
def background(settings):
    settings.NOTIFICATION_EMAIL_INLINE = False
    with mock.patch.object(services, "_email_pool") as pool:
        yield pool


@pytest.mark.django_db
def test_nothing_is_sent_while_the_transaction_is_open(org, background):
    notify(org["employee"].user, title="Hello")

    background.submit.assert_not_called()
    assert Notification.objects.filter(recipient=org["employee"].user).exists()


@pytest.mark.django_db
def test_it_goes_to_the_pool_once_committed(org, background, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        note = notify(org["employee"].user, title="Hello")

    background.submit.assert_called_once_with(services._send_email, note.pk)


@pytest.mark.django_db
def test_a_rolled_back_action_emails_nobody(org, background, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        try:
            with transaction.atomic():
                notify(org["employee"].user, title="Hello")
                raise RuntimeError("the action failed")
        except RuntimeError:
            pass

    background.submit.assert_not_called()


@pytest.mark.django_db
def test_a_request_can_ask_for_no_email(org, background, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        notify(org["employee"].user, title="Hello", send_email=False)

    background.submit.assert_not_called()


@pytest.mark.django_db
def test_the_pool_delivers_the_email(org, settings):
    settings.NOTIFICATION_EMAIL_INLINE = False
    note = notify(org["employee"].user, title="Hello", send_email=False)

    with mock.patch.object(services.connections, "close_all") as close_all:
        services._send_email(note.pk)

    assert len(mail.outbox) == 1
    close_all.assert_called_once()


@pytest.mark.django_db
def test_a_broker_that_cannot_be_reached_is_not_the_callers_problem(org, settings):
    settings.NOTIFICATION_EMAIL_INLINE = False
    note = notify(org["employee"].user, title="Hello", send_email=False)

    with (
        mock.patch.object(send_notification_email, "delay", side_effect=OSError("no broker")),
        mock.patch.object(services.connections, "close_all"),
    ):
        services._send_email(note.pk)

    note.refresh_from_db()
    assert note.emailed_at is None


@pytest.mark.django_db
def test_with_no_worker_a_failed_send_is_tried_once(org):
    note = notify(org["employee"].user, title="Hello", send_email=False)

    with mock.patch(
        "apps.notifications.tasks.send_mail", side_effect=TimeoutError("timed out")
    ) as send:
        result = send_notification_email.apply(args=[note.pk]).get()

    assert result == "failed"
    assert send.call_count == 1


@pytest.mark.django_db
def test_a_manager_approves_without_waiting_for_any_email(
    auth_client, org, background, leave_type, next_monday
):
    request = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Unwell.")

    response = auth_client(org["manager"]).post(
        f"/api/v1/leaves/{request.pk}/approve/", {"comment": "Approved"}
    )

    assert response.status_code == 200, response.data
    request.refresh_from_db()
    assert request.status == LeaveStatus.PENDING_HR


@pytest.mark.django_db
def test_a_manager_rejects_without_waiting_for_any_email(
    auth_client, org, background, leave_type, next_monday
):
    request = apply_for_leave(org["employee"], leave_type, next_monday, next_monday, "Unwell.")
    balance = LeaveBalance.objects.get(employee=org["employee"], leave_type=leave_type)
    assert balance.pending_days == request.total_days

    response = auth_client(org["manager"]).post(
        f"/api/v1/leaves/{request.pk}/reject/", {"comment": "Team is short that week."}
    )

    assert response.status_code == 200, response.data
    request.refresh_from_db()
    balance.refresh_from_db()
    assert request.status == LeaveStatus.REJECTED
    assert balance.pending_days == 0, "the reserved days go back"
    assert Notification.objects.filter(
        recipient=org["employee"].user, title="Leave rejected"
    ).exists()
