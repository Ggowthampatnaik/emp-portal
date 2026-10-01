"""The Finance module: HR processes a payslip, Finance releases it (F15).

There are now two approvals on the same money, and the whole point of this file
is that they stay distinct:

* the **run** approval, by an administrator - "is the month's calculation right?"
* the **payslip** release, by Finance - "should this one be paid out?"

Finance has no reject. A payslip it disagrees with is *queried*, which returns
it to HR with a comment, exactly like HR's send-back on leave.
"""

import pytest

from apps.finance.models import PayslipApproval
from apps.finance.services import process_payslip, query_payslip, release_payslip
from apps.notifications.models import Notification
from apps.payroll.services import approve_run, process_run
from common.enums import RoleSlug
from common.exceptions import BusinessRuleViolation, WorkflowStateError

QUEUE = "/api/v1/finance/approvals/"


@pytest.fixture
def finance_user(make_user, make_employee):
    """A Finance account: releases pay, and sees nothing else."""
    user = make_user("fatima.sheikh@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.FINANCE)
    make_employee(user, employee_code="TRG0011")
    return user


@pytest.fixture
def published(org, structure, run):
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)
    return run


@pytest.fixture
def slip(published, org):
    return published.payslips.get(employee=org["employee"])


@pytest.fixture
def with_finance(slip, org):
    """HR has pushed the payslip; it is sitting with Finance."""
    return process_payslip(slip.pk, org["hr"].user)


# ---------------------------------------------------------------------------
# HR pushes
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_pushes_a_payslip_to_finance(auth_client, org, slip):
    response = auth_client(org["hr"]).post(f"/api/v1/payslips/{slip.pk}/process/", {})

    assert response.status_code == 200, response.data
    approval = PayslipApproval.objects.get(payslip=slip)
    assert approval.status == PayslipApproval.Status.PROCESSED
    assert approval.processed_by == org["hr"].user


@pytest.mark.django_db
def test_the_run_must_be_approved_first(org, structure, run):
    """Finance is never asked to release money out of an unsigned month."""
    process_run(run.pk, org["hr"].user)  # processed, not approved
    slip = run.payslips.get(employee=org["employee"])

    with pytest.raises(BusinessRuleViolation, match="not been approved"):
        process_payslip(slip.pk, org["hr"].user)


@pytest.mark.django_db
def test_pushing_twice_is_refused(org, with_finance, slip):
    with pytest.raises(WorkflowStateError, match="already with Finance"):
        process_payslip(slip.pk, org["hr"].user)


@pytest.mark.django_db
def test_finance_cannot_process(auth_client, finance_user, org, slip):
    """Processing is HR's half of the split; Finance only releases."""
    from rest_framework.test import APIClient

    from apps.authentication.views import issue_token_pair

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(finance_user)['access']}")

    response = client.post(f"/api/v1/payslips/{slip.pk}/process/", {})
    assert response.status_code == 403


@pytest.mark.django_db
def test_an_employee_cannot_process_their_own_payslip(auth_client, org, slip):
    response = auth_client(org["employee"]).post(f"/api/v1/payslips/{slip.pk}/process/", {})
    assert response.status_code == 403


@pytest.mark.django_db
def test_finance_is_notified(org, finance_user, with_finance):
    note = Notification.objects.filter(recipient=finance_user).first()

    assert note is not None
    assert "Payslip to release" in note.title
    assert note.link == "/finance"


# ---------------------------------------------------------------------------
# Finance releases
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_finance_releases_the_payslip(finance_user, with_finance):
    released = release_payslip(with_finance.pk, finance_user, "Checked against the bank file.")

    assert released.status == PayslipApproval.Status.APPROVED
    assert released.approved_by == finance_user
    assert released.approved_at is not None
    assert released.is_released is True


@pytest.mark.django_db
def test_releasing_does_not_touch_the_amounts(finance_user, with_finance, slip):
    """Payroll owns the figures; Finance only decides when they are paid."""
    before = (slip.gross_earnings, slip.total_deductions, slip.net_pay)

    release_payslip(with_finance.pk, finance_user)

    slip.refresh_from_db()
    assert (slip.gross_earnings, slip.total_deductions, slip.net_pay) == before


@pytest.mark.django_db
def test_the_employee_is_told_their_pay_was_released(finance_user, with_finance, org):
    release_payslip(with_finance.pk, finance_user)

    note = Notification.objects.filter(
        recipient=org["employee"].user, title__contains="released"
    ).first()
    assert note is not None
    assert note.level == Notification.Level.SUCCESS


@pytest.mark.django_db
def test_whoever_processed_it_cannot_release_it(org, with_finance, make_user, make_employee):
    """Maker-checker again: HR pushing and releasing would defeat the split."""
    both = make_user("root.finance@trigyan.io", RoleSlug.SUPER_ADMIN)
    make_employee(both, employee_code="TRG9200")

    # A Super Admin holds every permission, so they could push a payslip and
    # then release it themselves - which is the case the rule exists for.
    with_finance.processed_by = both
    with_finance.save(update_fields=["processed_by"])

    with pytest.raises(BusinessRuleViolation, match="someone else has to release"):
        release_payslip(with_finance.pk, both)


@pytest.mark.django_db
def test_a_payslip_not_with_finance_cannot_be_released(finance_user, slip):
    approval = PayslipApproval.objects.create(payslip=slip)  # still pending with HR

    with pytest.raises(WorkflowStateError, match="not with Finance"):
        release_payslip(approval.pk, finance_user)


# ---------------------------------------------------------------------------
# Finance queries
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_query_sends_it_back_to_hr(finance_user, with_finance, org):
    queried = query_payslip(with_finance.pk, finance_user, "The LOP days look wrong.")

    assert queried.status == PayslipApproval.Status.QUERIED
    assert queried.comment == "The LOP days look wrong."
    assert queried.approved_by is None, "a query is not a release"

    note = Notification.objects.filter(recipient=org["hr"].user, title__contains="queried").first()
    assert note is not None
    assert "The LOP days look wrong." in note.message


@pytest.mark.django_db
def test_a_query_needs_a_reason(finance_user, with_finance):
    with pytest.raises(BusinessRuleViolation, match="Say what the query is"):
        query_payslip(with_finance.pk, finance_user, "   ")


@pytest.mark.django_db
def test_hr_can_push_a_queried_payslip_back(org, finance_user, with_finance, slip):
    query_payslip(with_finance.pk, finance_user, "Please re-check the LOP.")

    again = process_payslip(slip.pk, org["hr"].user, "Re-checked; the LOP is right.")

    assert again.status == PayslipApproval.Status.PROCESSED
    assert again.pk == with_finance.pk, "the same record, not a second one"


@pytest.mark.django_db
def test_a_released_payslip_cannot_be_reopened(finance_user, with_finance, org, slip):
    release_payslip(with_finance.pk, finance_user)

    with pytest.raises(WorkflowStateError, match="already been released"):
        process_payslip(slip.pk, org["hr"].user)


# ---------------------------------------------------------------------------
# The queue, and who may see it
# ---------------------------------------------------------------------------
def finance_client(user):
    from rest_framework.test import APIClient

    from apps.authentication.views import issue_token_pair

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token_pair(user)['access']}")
    return client


@pytest.mark.django_db
def test_finance_sees_its_queue(finance_user, with_finance, org):
    response = finance_client(finance_user).get(QUEUE, {"status": "processed"})

    assert response.status_code == 200
    row = response.data["results"][0]
    assert row["employee_name"] == org["employee"].full_name
    assert row["period_label"] == "July 2025"
    assert row["awaits_finance"] is True
    assert row["processed_by_name"] == org["hr"].full_name


@pytest.mark.django_db
def test_an_employee_cannot_see_the_finance_queue(auth_client, org, with_finance):
    assert auth_client(org["employee"]).get(QUEUE).status_code == 403


@pytest.mark.django_db
def test_a_manager_cannot_see_the_finance_queue(auth_client, org, with_finance):
    assert auth_client(org["manager"]).get(QUEUE).status_code == 403


@pytest.mark.django_db
def test_hr_cannot_release_from_the_finance_queue(auth_client, org, with_finance):
    """HR may hold `payroll.view_all`, but releasing is Finance's alone."""
    response = auth_client(org["hr"]).post(f"{QUEUE}{with_finance.pk}/approve/", {})
    assert response.status_code == 403


@pytest.mark.django_db
def test_finance_releases_through_the_api(finance_user, with_finance):
    response = finance_client(finance_user).post(
        f"{QUEUE}{with_finance.pk}/approve/", {"comment": "Bank file matched."}
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == "approved"
    assert response.data["approved_by_name"] == finance_user.full_name


@pytest.mark.django_db
def test_finance_queries_through_the_api(finance_user, with_finance):
    response = finance_client(finance_user).post(
        f"{QUEUE}{with_finance.pk}/query/", {"comment": "The LOP days look wrong."}
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == "queried"


@pytest.mark.django_db
def test_the_api_refuses_a_query_with_no_comment(finance_user, with_finance):
    response = finance_client(finance_user).post(f"{QUEUE}{with_finance.pk}/query/", {})
    assert response.status_code == 400
    assert "comment" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_queue_row_carries_the_full_breakdown_on_detail(finance_user, with_finance):
    response = finance_client(finance_user).get(f"{QUEUE}{with_finance.pk}/")

    assert response.status_code == 200
    assert response.data["payslip_detail"]["basic"] == "40000.00"


# ---------------------------------------------------------------------------
# What the Finance role can reach
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_finance_role_sees_pay_and_nothing_else(finance_user, org, with_finance):
    """The narrowest role in the portal: no employee records, no leave, no timesheets."""
    client = finance_client(finance_user)

    assert client.get(QUEUE).status_code == 200
    assert client.get("/api/v1/payslips/").status_code == 200

    # Its own profile is fine; everyone else's is not.
    listing = client.get("/api/v1/employees/")
    assert listing.status_code == 200
    assert {row["employee_code"] for row in listing.data["results"]} == {"TRG0011"}

    assert client.get("/api/v1/leaves/").data["count"] == 0
    assert client.get("/api/v1/admin/users/").status_code == 403
    assert client.get("/api/v1/reports/employees/").status_code == 403
