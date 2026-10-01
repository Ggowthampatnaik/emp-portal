"""Bank details: who may read them, who may write them, and what leaks.

Decision D9 is the whole point of this file - the employee and HR, never the
reporting manager - so most of these tests are about the negative case.
"""

import pytest

from apps.administration.models import AuditLog
from apps.employees.models import BankAccount
from common.enums import AuditAction

ACCOUNT = {
    "account_holder_name": "Asha Rao",
    "bank_name": "HDFC Bank",
    "branch_name": "Hitech City",
    "account_number": "50100234567788",
    "ifsc_code": "HDFC0001234",
    "account_type": "salary",
}


def url(employee) -> str:
    return f"/api/v1/employees/{employee.pk}/bank-account/"


@pytest.fixture
def account(org) -> BankAccount:
    return BankAccount.objects.create(employee=org["employee"], **ACCOUNT)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_records_their_own_account(auth_client, org):
    response = auth_client(org["employee"]).put(url(org["employee"]), ACCOUNT)

    assert response.status_code == 201, response.data
    assert BankAccount.objects.get(employee=org["employee"]).account_number == "50100234567788"


@pytest.mark.django_db
def test_a_second_save_updates_rather_than_duplicates(auth_client, org, account):
    client = auth_client(org["employee"])
    response = client.put(url(org["employee"]), {**ACCOUNT, "bank_name": "ICICI Bank"})

    assert response.status_code == 200
    assert BankAccount.objects.filter(employee=org["employee"]).count() == 1
    assert response.data["bank_name"] == "ICICI Bank"


@pytest.mark.django_db
def test_hr_maintains_someone_elses_account(auth_client, org):
    response = auth_client(org["hr"]).put(url(org["employee"]), ACCOUNT)
    assert response.status_code == 201


@pytest.mark.django_db
def test_an_employee_cannot_touch_a_colleagues_account(auth_client, org, account):
    response = auth_client(org["peer"]).put(url(org["employee"]), ACCOUNT)
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_reporting_manager_is_locked_out(auth_client, org, account):
    """D9: a manager can see the person's record but not where their pay goes."""
    client = auth_client(org["manager"])

    assert client.get(f"/api/v1/employees/{org['employee'].pk}/").status_code == 200
    assert client.get(url(org["employee"])).status_code == 403
    assert client.put(url(org["employee"]), ACCOUNT).status_code == 403


@pytest.mark.django_db
def test_the_account_can_be_removed(auth_client, org, account):
    response = auth_client(org["employee"]).delete(url(org["employee"]))

    assert response.status_code == 204
    assert not BankAccount.objects.filter(employee=org["employee"]).exists()


# ---------------------------------------------------------------------------
# Masking
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_owner_sees_the_whole_number(auth_client, org, account):
    response = auth_client(org["employee"]).get(url(org["employee"]))

    assert response.status_code == 200
    assert response.data["account_number"] == "50100234567788"
    assert response.data["account_number_masked"] == "XXXXXXXXXX7788"


@pytest.mark.django_db
def test_hr_sees_only_the_last_four_digits(auth_client, org, account):
    response = auth_client(org["hr"]).get(url(org["employee"]))

    assert response.status_code == 200
    assert response.data["account_number_masked"] == "XXXXXXXXXX7788"
    assert "account_number" not in response.data, "the full number must not leave the owner's view"


@pytest.mark.django_db
def test_the_number_is_masked_in_the_write_response_too(auth_client, org):
    """HR can set an account without being able to read it back."""
    response = auth_client(org["hr"]).put(url(org["employee"]), ACCOUNT)

    assert response.status_code == 201
    assert "account_number" not in response.data
    assert response.data["account_number_masked"] == "XXXXXXXXXX7788"


@pytest.mark.django_db
def test_a_missing_account_is_a_404_not_an_empty_body(auth_client, org):
    response = auth_client(org["employee"]).get(url(org["employee"]))
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
@pytest.mark.django_db
@pytest.mark.parametrize(
    "bad_ifsc",
    ["HDFC1001234", "HDF0001234", "HDFC0001", "hdfc0001234x", "HDFC-001234"],
)
def test_a_malformed_ifsc_is_refused(auth_client, org, bad_ifsc):
    response = auth_client(org["employee"]).put(
        url(org["employee"]), {**ACCOUNT, "ifsc_code": bad_ifsc}
    )
    assert response.status_code == 400
    assert "ifsc_code" in response.data["error"]["details"]


@pytest.mark.django_db
def test_a_lower_case_ifsc_is_accepted_and_stored_upper(auth_client, org):
    response = auth_client(org["employee"]).put(
        url(org["employee"]), {**ACCOUNT, "ifsc_code": "hdfc0001234"}
    )

    assert response.status_code == 201
    assert response.data["ifsc_code"] == "HDFC0001234"


@pytest.mark.django_db
def test_an_account_number_with_spaces_is_refused(auth_client, org):
    response = auth_client(org["employee"]).put(
        url(org["employee"]), {**ACCOUNT, "account_number": "5010 0234 5677"}
    )
    assert response.status_code == 400
    assert "account_number" in response.data["error"]["details"]


@pytest.mark.django_db
def test_a_short_account_number_is_refused(auth_client, org):
    response = auth_client(org["employee"]).put(
        url(org["employee"]), {**ACCOUNT, "account_number": "123"}
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_every_change_is_audited(auth_client, org, account):
    auth_client(org["hr"]).put(url(org["employee"]), {**ACCOUNT, "bank_name": "Axis Bank"})

    entry = AuditLog.objects.filter(entity_type="BankAccount").latest("created_at")
    assert entry.action == AuditAction.UPDATE
    assert entry.actor_email == org["hr"].email
    assert entry.changes["bank_name"] == "Axis Bank"


@pytest.mark.django_db
def test_the_audit_log_never_holds_the_full_number(auth_client, org):
    auth_client(org["employee"]).put(url(org["employee"]), ACCOUNT)

    entry = AuditLog.objects.filter(entity_type="BankAccount").latest("created_at")
    assert entry.changes["account_number"] == "XXXXXXXXXX7788"
    assert "50100234567788" not in str(entry.changes)


@pytest.mark.django_db
def test_removal_is_audited(auth_client, org, account):
    auth_client(org["employee"]).delete(url(org["employee"]))

    entry = AuditLog.objects.filter(entity_type="BankAccount").latest("created_at")
    assert entry.action == AuditAction.DELETE


# ---------------------------------------------------------------------------
# Masking rule itself
# ---------------------------------------------------------------------------
@pytest.mark.django_db
@pytest.mark.parametrize(
    ("number", "masked"),
    [
        ("50100234567788", "XXXXXXXXXX7788"),
        ("123456", "XX3456"),
        ("1234", "1234"),
    ],
)
def test_masking_keeps_exactly_four_digits(number, masked):
    assert BankAccount(account_number=number).masked_account_number == masked
