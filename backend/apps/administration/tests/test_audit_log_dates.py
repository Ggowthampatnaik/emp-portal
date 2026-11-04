"""The audit trail's date filter, on the company's calendar.

It used to be `created_at__date`, which on MySQL asks the server to convert time
zones by name. A server without the optional time zone tables answers NULL for
every row, so filtering by date found nothing at all, with no error - and the
tables are not there on a fresh install. These pin the behaviour; run them
against MySQL as well as SQLite when touching this.
"""

from datetime import UTC, datetime

import pytest

from apps.administration.models import AuditLog
from common.enums import AuditAction

URL = "/api/v1/admin/audit-logs/"
# The company runs on IST, 5h30 ahead: midnight on 11 March is 18:30 on the 10th.
LAST_MINUTE_OF_THE_10TH = datetime(2026, 3, 10, 18, 29, tzinfo=UTC)
FIRST_MINUTE_OF_THE_11TH = datetime(2026, 3, 10, 18, 30, tzinfo=UTC)


@pytest.fixture
def entries(db):
    rows = {}
    for label, moment in (
        ("late on the 10th", LAST_MINUTE_OF_THE_10TH),
        ("early on the 11th", FIRST_MINUTE_OF_THE_11TH),
    ):
        row = AuditLog.objects.create(action=AuditAction.UPDATE, entity_label=label)
        AuditLog.objects.filter(pk=row.pk).update(created_at=moment)
        rows[label] = row
    return rows


def labels(response) -> set[str]:
    assert response.status_code == 200, response.data
    return {row["entity_label"] for row in response.data["results"]}


@pytest.mark.django_db
def test_from_starts_at_midnight_company_time(auth_client, org, entries):
    response = auth_client(org["admin"]).get(URL, {"from": "2026-03-11"})

    assert labels(response) == {"early on the 11th"}


@pytest.mark.django_db
def test_to_runs_to_the_end_of_that_day(auth_client, org, entries):
    response = auth_client(org["admin"]).get(URL, {"to": "2026-03-10"})

    assert labels(response) == {"late on the 10th"}


@pytest.mark.django_db
def test_a_single_day_finds_what_happened_on_it(auth_client, org, entries):
    response = auth_client(org["admin"]).get(URL, {"from": "2026-03-11", "to": "2026-03-11"})

    assert labels(response) == {"early on the 11th"}


@pytest.mark.django_db
@pytest.mark.parametrize("value", ["yesterday", "2026-02-31"])
def test_a_date_that_is_not_one_is_refused(auth_client, org, value):
    response = auth_client(org["admin"]).get(URL, {"from": value})

    assert response.status_code == 400
