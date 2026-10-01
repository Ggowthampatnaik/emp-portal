"""Payroll: pay calculation, the maker-checker workflow, and who sees what."""

from datetime import date
from decimal import Decimal

import pytest

from apps.leave_management.models import Holiday
from apps.payroll.models import PayrollRun, Payslip, SalaryStructure
from apps.payroll.services import (
    approve_run,
    build_payslip,
    mark_paid,
    month_working_days,
    process_run,
    reject_run,
    structure_in_force,
    unpaid_leave_days,
)
from common.exceptions import BusinessRuleViolation, WorkflowStateError

# structure / run / unpaid_leave_type live in the root conftest: the payslip PDF
# and Finance tests need the same salary and the same month.
from conftest import PAYROLL_MONTH as MONTH
from conftest import PAYROLL_YEAR as YEAR


# ---------------------------------------------------------------------------
# The structure itself
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_structure_totals_its_components(structure):
    assert structure.gross_monthly == Decimal("70000")
    assert structure.deductions_monthly == Decimal("10000")
    assert structure.net_monthly == Decimal("60000")
    assert structure.annual_ctc == Decimal("840000")


@pytest.mark.django_db
def test_the_structure_in_force_is_the_latest_that_has_started(structure, org):
    raise_ = SalaryStructure.objects.create(
        employee=org["employee"],
        effective_from=date(2025, 4, 1),
        basic=Decimal("50000"),
        hra=Decimal("25000"),
    )

    assert structure_in_force(org["employee"], date(2025, 3, 31)) == structure
    assert structure_in_force(org["employee"], date(2025, 4, 1)) == raise_
    assert structure_in_force(org["employee"], date(2023, 1, 1)) is None


@pytest.mark.django_db
def test_a_new_structure_closes_the_previous_one(auth_client, org, structure):
    response = auth_client(org["hr"]).post(
        "/api/v1/salary-structures/",
        {
            "employee": org["employee"].pk,
            "effective_from": "2025-04-01",
            "basic": "50000",
            "hra": "25000",
        },
    )
    assert response.status_code == 201, response.data

    structure.refresh_from_db()
    assert structure.effective_to == date(2025, 3, 31)


@pytest.mark.django_db
def test_deductions_may_not_exceed_earnings(auth_client, org):
    response = auth_client(org["hr"]).post(
        "/api/v1/salary-structures/",
        {
            "employee": org["employee"].pk,
            "effective_from": "2025-01-01",
            "basic": "10000",
            "income_tax": "12000",
        },
    )
    assert response.status_code == 400
    assert "other_deductions" in response.data["error"]["details"]


@pytest.mark.django_db
def test_two_structures_cannot_start_on_the_same_day(auth_client, org, structure):
    response = auth_client(org["hr"]).post(
        "/api/v1/salary-structures/",
        {
            "employee": org["employee"].pk,
            "effective_from": structure.effective_from.isoformat(),
            "basic": "1000",
        },
    )
    assert response.status_code == 400
    assert "effective_from" in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# Working days and unpaid leave
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_working_days_exclude_weekends_and_holidays(db):
    assert month_working_days(YEAR, MONTH) == 23  # July 2025 has 23 weekdays

    Holiday.objects.create(date=date(YEAR, MONTH, 15), name="Founders Day")
    assert month_working_days(YEAR, MONTH) == 22

    Holiday.objects.create(date=date(YEAR, MONTH, 16), name="Floating", is_optional=True)
    assert month_working_days(YEAR, MONTH) == 22, "optional holidays are still working days"


@pytest.mark.django_db
def test_only_unpaid_approved_leave_counts_as_lop(
    org, structure, unpaid_leave_type, leave_type, approve_leave, book_past_leave
):
    employee, manager = org["employee"], org["manager"]

    paid = book_past_leave(
        employee, leave_type, date(YEAR, MONTH, 7), date(YEAR, MONTH, 8), "Paid days off."
    )
    approve_leave(paid.pk, manager.user)

    unpaid = book_past_leave(
        employee, unpaid_leave_type, date(YEAR, MONTH, 14), date(YEAR, MONTH, 16), "Unpaid."
    )
    approve_leave(unpaid.pk, manager.user)

    pending = book_past_leave(
        employee, unpaid_leave_type, date(YEAR, MONTH, 21), date(YEAR, MONTH, 22), "Not decided."
    )
    assert pending.status == "pending_manager"

    # Only the approved unpaid request counts: 14-16 July is 3 working days.
    assert unpaid_leave_days(employee, YEAR, MONTH) == Decimal("3")


@pytest.mark.django_db
def test_leave_spanning_two_months_is_counted_per_month(
    org, unpaid_leave_type, approve_leave, book_past_leave
):
    employee = org["employee"]
    request = book_past_leave(
        employee, unpaid_leave_type, date(YEAR, MONTH, 30), date(YEAR, MONTH + 1, 1), "Straddles."
    )
    approve_leave(request.pk, org["manager"].user)

    july = unpaid_leave_days(employee, YEAR, MONTH)
    august = unpaid_leave_days(employee, YEAR, MONTH + 1)
    assert july == Decimal("2")  # 30, 31 July
    assert august == Decimal("1")  # 1 August
    assert july + august == request.total_days


# ---------------------------------------------------------------------------
# The calculation
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_a_full_month_pays_the_whole_salary(org, structure, run):
    slip = build_payslip(run, org["employee"], structure, working=22)

    assert slip.lop_days == Decimal("0")
    assert slip.paid_days == Decimal("22")
    assert slip.gross_earnings == Decimal("70000.00")
    assert slip.total_deductions == Decimal("10000.00")
    assert slip.net_pay == Decimal("60000.00")
    assert slip.lop_amount == Decimal("0.00")


@pytest.mark.django_db
def test_unpaid_leave_is_deducted_pro_rata(
    org, structure, run, unpaid_leave_type, approve_leave, book_past_leave
):
    """Two unpaid days out of 22 costs 2/22 of the gross."""
    request = book_past_leave(
        org["employee"],
        unpaid_leave_type,
        date(YEAR, MONTH, 14),
        date(YEAR, MONTH, 15),
        "Two unpaid days.",
    )
    approve_leave(request.pk, org["manager"].user)

    slip = build_payslip(run, org["employee"], structure, working=22)

    assert slip.lop_days == Decimal("2")
    assert slip.paid_days == Decimal("20")
    # Components are rounded individually, then summed: 63636.37.
    assert slip.gross_earnings == Decimal("63636.37")
    assert slip.lop_amount == Decimal("6363.63")
    assert slip.net_pay == Decimal("53636.37")
    # The payslip reconciles: what was paid plus what was withheld is the
    # full monthly gross, to the paisa.
    assert slip.gross_earnings + slip.lop_amount == structure.gross_monthly


@pytest.mark.django_db
def test_the_components_still_sum_to_the_gross_after_prorating(
    org, structure, run, unpaid_leave_type, approve_leave, book_past_leave
):
    request = book_past_leave(
        org["employee"],
        unpaid_leave_type,
        date(YEAR, MONTH, 14),
        date(YEAR, MONTH, 16),
        "Three unpaid days.",
    )
    approve_leave(request.pk, org["manager"].user)

    slip = build_payslip(run, org["employee"], structure, working=22)
    components = (
        slip.basic
        + slip.hra
        + slip.conveyance_allowance
        + slip.medical_allowance
        + slip.special_allowance
    )
    assert components == slip.gross_earnings


@pytest.mark.django_db
def test_lop_cannot_exceed_the_working_days(
    org, structure, run, unpaid_leave_type, approve_leave, book_past_leave
):
    request = book_past_leave(
        org["employee"],
        unpaid_leave_type,
        date(YEAR, MONTH, 1),
        date(YEAR, MONTH, 31),
        "The whole month.",
    )
    approve_leave(request.pk, org["manager"].user)

    slip = build_payslip(run, org["employee"], structure, working=22)
    assert slip.lop_days == Decimal("22")
    assert slip.paid_days == Decimal("0")
    assert slip.gross_earnings == Decimal("0.00")


# ---------------------------------------------------------------------------
# Processing a run
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_processing_creates_a_payslip_per_employee_with_a_structure(org, structure, run):
    processed = process_run(run.pk, org["hr"].user)

    assert processed.status == PayrollRun.Status.PROCESSED
    assert processed.employee_count == 1, "only one employee has a salary structure"
    assert processed.total_net == Decimal("60000.00")
    assert processed.processed_by == org["hr"].user
    assert Payslip.objects.filter(run=run).count() == 1


@pytest.mark.django_db
def test_processing_again_replaces_the_previous_payslips(org, structure, run):
    process_run(run.pk, org["hr"].user)
    first = Payslip.objects.get(run=run)

    structure.special_allowance = Decimal("10000")
    structure.save(update_fields=["special_allowance"])
    process_run(run.pk, org["hr"].user)

    slips = Payslip.objects.filter(run=run)
    assert slips.count() == 1
    assert slips.first().pk != first.pk
    assert slips.first().gross_earnings == Decimal("74000.00")


@pytest.mark.django_db
def test_a_run_with_nobody_to_pay_is_refused(org, run):
    with pytest.raises(BusinessRuleViolation, match="nothing to process"):
        process_run(run.pk, org["hr"].user)


@pytest.mark.django_db
def test_an_approved_run_cannot_be_reprocessed(org, structure, run):
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)

    with pytest.raises(WorkflowStateError, match="no longer be processed"):
        process_run(run.pk, org["hr"].user)


# ---------------------------------------------------------------------------
# Maker-checker
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_processor_cannot_approve_their_own_run(org, structure, run):
    process_run(run.pk, org["hr"].user)
    with pytest.raises(BusinessRuleViolation, match="other than the person who processed"):
        approve_run(run.pk, org["hr"].user)


@pytest.mark.django_db
def test_an_administrator_approves_and_then_releases(org, structure, run):
    process_run(run.pk, org["hr"].user)

    approved = approve_run(run.pk, org["admin"].user)
    assert approved.status == PayrollRun.Status.APPROVED
    assert approved.is_locked is True

    paid = mark_paid(run.pk, org["admin"].user)
    assert paid.status == PayrollRun.Status.PAID
    assert paid.paid_at is not None


@pytest.mark.django_db
def test_a_draft_cannot_be_approved(org, run):
    with pytest.raises(WorkflowStateError, match="Only a processed run"):
        approve_run(run.pk, org["admin"].user)


@pytest.mark.django_db
def test_rejection_sends_the_run_back_to_draft(org, structure, run):
    process_run(run.pk, org["hr"].user)
    sent_back = reject_run(run.pk, org["admin"].user, "The special allowance is wrong.")

    assert sent_back.status == PayrollRun.Status.DRAFT
    assert sent_back.processed_by is None
    assert "special allowance" in sent_back.notes


@pytest.mark.django_db
def test_a_rejection_needs_a_reason(org, structure, run):
    process_run(run.pk, org["hr"].user)
    with pytest.raises(BusinessRuleViolation, match="what needs correcting"):
        reject_run(run.pk, org["admin"].user, "")


@pytest.mark.django_db
def test_releasing_notifies_every_employee_paid(org, structure, run):
    from apps.notifications.models import Notification

    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)
    mark_paid(run.pk, org["admin"].user)

    note = Notification.objects.filter(recipient=org["employee"].user).first()
    assert note is not None
    assert "Payslip" in note.title


# ---------------------------------------------------------------------------
# Who may see and do what
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_cannot_see_salary_structures(auth_client, org, structure):
    assert auth_client(org["employee"]).get("/api/v1/salary-structures/").status_code == 403


@pytest.mark.django_db
def test_an_employee_cannot_open_a_payroll_run(auth_client, org, run):
    assert auth_client(org["employee"]).get("/api/v1/payroll-runs/").status_code == 403


@pytest.mark.django_db
def test_hr_processes_but_cannot_approve(auth_client, org, structure, run):
    client = auth_client(org["hr"])
    assert client.post(f"/api/v1/payroll-runs/{run.pk}/process/", {}).status_code == 200
    assert client.post(f"/api/v1/payroll-runs/{run.pk}/approve/", {}).status_code == 403


@pytest.mark.django_db
def test_an_administrator_approves_through_the_api(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)
    response = auth_client(org["admin"]).post(f"/api/v1/payroll-runs/{run.pk}/approve/", {})
    assert response.status_code == 200, response.data
    assert response.data["status"] == PayrollRun.Status.APPROVED


@pytest.mark.django_db
def test_payslips_stay_hidden_until_the_run_is_approved(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)

    client = auth_client(org["employee"])
    assert client.get("/api/v1/payslips/me/").data == []

    approve_run(run.pk, org["admin"].user)
    rows = client.get("/api/v1/payslips/me/").data
    assert len(rows) == 1
    assert rows[0]["net_pay"] == "60000.00"
    assert rows[0]["period_label"] == "July 2025"


@pytest.mark.django_db
def test_an_employee_cannot_read_a_colleagues_payslip(
    auth_client, org, structure, run, make_employee, make_user
):
    SalaryStructure.objects.create(
        employee=org["peer"], effective_from=date(2024, 1, 1), basic=Decimal("30000")
    )
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)

    peer_slip = Payslip.objects.get(employee=org["peer"])
    response = auth_client(org["employee"]).get(f"/api/v1/payslips/{peer_slip.pk}/")
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_hr_sees_every_payslip(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)
    response = auth_client(org["hr"]).get("/api/v1/payslips/")
    assert response.status_code == 200
    assert response.data["count"] == 1, "HR sees payslips even before approval"


@pytest.mark.django_db
def test_the_bank_sheet_exports_as_csv(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)
    response = auth_client(org["hr"]).get(f"/api/v1/payroll-runs/{run.pk}/export/")

    assert response.status_code == 200
    assert response["Content-Type"] == "text/csv"
    body = response.content.decode()
    assert body.splitlines()[0].startswith("employee_code,employee,department")
    assert "60000.00" in body


@pytest.mark.django_db
def test_two_runs_cannot_cover_the_same_month(auth_client, org, run):
    response = auth_client(org["hr"]).post("/api/v1/payroll-runs/", {"year": YEAR, "month": MONTH})
    assert response.status_code == 400
    assert "month" in response.data["error"]["details"]


@pytest.mark.django_db
def test_an_approved_run_cannot_be_deleted(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)

    # Deleting needs payroll.process, which HR holds.
    response = auth_client(org["hr"]).delete(f"/api/v1/payroll-runs/{run.pk}/")
    assert response.status_code == 403
    assert PayrollRun.objects.filter(pk=run.pk).exists()


@pytest.mark.django_db
def test_a_structure_used_on_a_payslip_cannot_be_deleted(auth_client, org, structure, run):
    process_run(run.pk, org["hr"].user)
    response = auth_client(org["hr"]).delete(f"/api/v1/salary-structures/{structure.pk}/")
    assert response.status_code == 403
    assert SalaryStructure.objects.filter(pk=structure.pk).exists()


@pytest.mark.django_db
def test_a_payslip_keeps_its_amounts_when_the_structure_changes(org, structure, run):
    """History must reconcile: a later raise cannot rewrite a paid payslip."""
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)
    slip = Payslip.objects.get(run=run)
    original_net = slip.net_pay

    structure.basic = Decimal("999999")
    structure.save(update_fields=["basic"])

    slip.refresh_from_db()
    assert slip.net_pay == original_net


@pytest.mark.django_db
def test_a_manager_lists_only_their_own_payslips(auth_client, org, structure, run):
    """The list used to be scoped to the manager's branch, so it disclosed every
    report's net pay while the detail endpoint refused the same rows. A manager
    approves their team's leave and hours; their pay is HR's business."""
    process_run(run.pk, actor=org["hr"].user)
    approve_run(run.pk, actor=org["admin"].user)

    rows = auth_client(org["manager"]).get("/api/v1/payslips/").data["results"]

    assert {row["employee"] for row in rows} <= {org["manager"].pk}
    assert Payslip.objects.filter(run=run, employee=org["employee"]).exists()
