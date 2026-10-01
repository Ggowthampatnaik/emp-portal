"""The payslip PDF and the year/month drill-down behind it (F13, F14).

A payslip is the document people forward to a bank or a landlord, so the two
things worth holding are that it says what the portal says, and that it is only
ever handed to the person it belongs to.
"""

from datetime import date
from decimal import Decimal

import pytest

from apps.payroll.amounts import number_to_words, rupees_in_words
from apps.payroll.models import PayrollRun
from apps.payroll.pdf import payslip_filename, render_payslip_pdf
from apps.payroll.services import approve_run, process_run
from conftest import PAYROLL_MONTH as MONTH
from conftest import PAYROLL_YEAR as YEAR


@pytest.fixture
def published(org, structure, run):
    """A payroll month that has been processed and signed off, so it is visible."""
    process_run(run.pk, org["hr"].user)
    approve_run(run.pk, org["admin"].user)
    run.refresh_from_db()
    return run


@pytest.fixture
def slip(published, org):
    return published.payslips.get(employee=org["employee"])


def pdf_url(payslip) -> str:
    return f"/api/v1/payslips/{payslip.pk}/pdf/"


# ---------------------------------------------------------------------------
# Amounts in words
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "zero"),
        (7, "seven"),
        (19, "nineteen"),
        (40, "forty"),
        (99, "ninety nine"),
        (100, "one hundred"),
        (1_000, "one thousand"),
        (42_500, "forty two thousand five hundred"),
        # Indian grouping: lakh and crore, not "hundred thousand".
        (125_000, "one lakh twenty five thousand"),
        (10_000_000, "one crore"),
    ],
)
def test_numbers_are_written_in_the_indian_scale(value, expected):
    assert number_to_words(value) == expected


def test_a_round_amount_does_not_mention_paise():
    assert rupees_in_words(Decimal("42500.00")) == "Rupees Forty Two Thousand Five Hundred Only"


def test_paise_are_named_when_there_are_some():
    words = rupees_in_words(Decimal("42500.50"))
    assert words == "Rupees Forty Two Thousand Five Hundred and Fifty Paise Only"


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------
def text_of(content: bytes) -> str:
    """The words on the page, so assertions can be about what is printed."""
    from io import BytesIO

    from pypdf import PdfReader

    return chr(10).join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)


@pytest.mark.django_db
def test_the_pdf_is_a_pdf(slip):
    content = render_payslip_pdf(slip)

    assert content.startswith(b"%PDF-"), "must be a real PDF, not an HTML error page"
    assert content.rstrip().endswith(b"%%EOF")
    assert len(content) > 1000


@pytest.mark.django_db
def test_the_pdf_prints_the_figures_from_the_payslip(slip):
    """The document and the screen must agree - to the rupee."""
    text = text_of(render_payslip_pdf(slip))

    assert "Asha Rao" in text
    assert "TRG0005" in text
    assert slip.run.period_label in text
    # The fixture salary: 70,000 gross less 10,000 deductions. Written with
    # Indian grouping and two decimal places, as money on a payslip should be.
    assert slip.net_pay == Decimal("60000.00"), "the fixture changed; update the figures below"
    assert "70,000.00" in text, "gross earnings"
    assert "10,000.00" in text, "total deductions"
    assert "60,000.00" in text, "net pay"
    assert "Rupees Sixty Thousand Only" in text


@pytest.mark.django_db
def test_the_pdf_shows_what_the_pay_was_calculated_on(slip):
    text = text_of(render_payslip_pdf(slip))

    assert "Working days" in text
    assert "Paid days" in text
    assert "Loss of pay" in text
    assert "does not require a signature" in text


@pytest.mark.django_db
def test_the_filename_follows_the_agreed_pattern(slip):
    """`EmployeeName_Year_Month.pdf`, with the name kept as one token."""
    assert payslip_filename(slip) == f"AshaRao_{YEAR}_July.pdf"


@pytest.mark.django_db
def test_downloading_gives_a_pdf_with_that_name(auth_client, org, slip):
    response = auth_client(org["employee"]).get(pdf_url(slip))

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"] == (f'attachment; filename="AshaRao_{YEAR}_July.pdf"')
    assert response.content.startswith(b"%PDF-")


@pytest.mark.django_db
def test_hr_can_download_anyones(auth_client, org, slip):
    assert auth_client(org["hr"]).get(pdf_url(slip)).status_code == 200


@pytest.mark.django_db
def test_a_colleague_cannot_download_yours(auth_client, org, slip):
    """The one thing that must never happen: someone else's salary in a file."""
    response = auth_client(org["peer"]).get(pdf_url(slip))
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_a_manager_cannot_download_their_reports_payslip(auth_client, org, slip):
    """Pay is HR's business, not the line manager's."""
    response = auth_client(org["manager"]).get(pdf_url(slip))
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_an_unpublished_payslip_cannot_be_downloaded(auth_client, org, structure, run):
    """A draft calculation is not something to hand anybody."""
    process_run(run.pk, org["hr"].user)  # processed but not approved
    slip = run.payslips.get(employee=org["employee"])

    assert auth_client(org["employee"]).get(pdf_url(slip)).status_code == 404


@pytest.mark.django_db
def test_a_missing_payslip_is_a_404(auth_client, org):
    assert auth_client(org["employee"]).get("/api/v1/payslips/99999/pdf/").status_code == 404


# ---------------------------------------------------------------------------
# The drill-down
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_periods_group_months_under_their_year(auth_client, org, slip):
    response = auth_client(org["employee"]).get("/api/v1/payslips/periods/")

    assert response.status_code == 200
    years = response.data["years"]
    assert [year["year"] for year in years] == [YEAR]
    assert years[0]["months"][0]["month"] == MONTH
    assert years[0]["months"][0]["month_name"] == "July"
    assert years[0]["months"][0]["payslip_id"] == slip.pk


@pytest.mark.django_db
def test_periods_total_the_year(auth_client, org, slip):
    response = auth_client(org["employee"]).get("/api/v1/payslips/periods/")

    year = response.data["years"][0]
    assert Decimal(year["total_net"]) == slip.net_pay


@pytest.mark.django_db
def test_periods_are_empty_before_anything_is_published(auth_client, org, structure, run):
    response = auth_client(org["employee"]).get("/api/v1/payslips/periods/")
    assert response.data["years"] == []


@pytest.mark.django_db
def test_hr_can_read_someone_elses_periods(auth_client, org, slip):
    response = auth_client(org["hr"]).get(
        "/api/v1/payslips/periods/", {"employee": org["employee"].pk}
    )

    assert response.status_code == 200
    assert response.data["years"][0]["months"][0]["payslip_id"] == slip.pk


@pytest.mark.django_db
def test_an_employee_cannot_read_someone_elses_periods(auth_client, org, slip):
    response = auth_client(org["employee"]).get(
        "/api/v1/payslips/periods/", {"employee": org["peer"].pk}
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# The project filter (F14)
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_can_filter_payslips_by_project(auth_client, org, allocated_project, published):
    response = auth_client(org["hr"]).get("/api/v1/payslips/", {"project": allocated_project.pk})

    assert response.status_code == 200
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0005"}, "only the person actually on that project"


@pytest.mark.django_db
def test_the_project_filter_composes_with_year_and_month(
    auth_client, org, allocated_project, published
):
    client = auth_client(org["hr"])
    matching = client.get(
        "/api/v1/payslips/",
        {"project": allocated_project.pk, "year": YEAR, "month": MONTH},
    )
    other_month = client.get(
        "/api/v1/payslips/", {"project": allocated_project.pk, "year": YEAR, "month": MONTH + 1}
    )

    assert matching.data["count"] == 1
    assert other_month.data["count"] == 0


@pytest.mark.django_db
def test_a_nonsense_project_filter_is_refused(auth_client, org, published):
    response = auth_client(org["hr"]).get("/api/v1/payslips/", {"project": "northwind"})

    assert response.status_code == 400
    assert "project" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_filter_cannot_be_used_to_see_other_people(
    auth_client, org, allocated_project, published
):
    """Filtering is not a way round the scoping - an employee still sees themselves."""
    response = auth_client(org["peer"]).get("/api/v1/payslips/", {"project": allocated_project.pk})

    assert response.status_code == 200
    assert response.data["count"] == 0


# ---------------------------------------------------------------------------
# The figures on the page and in the file agree
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_the_document_reflects_the_stored_snapshot(slip):
    """The PDF must be built from the payslip row, not recomputed."""
    before = render_payslip_pdf(slip)

    # Move the salary structure on. A recomputed PDF would change; a snapshot
    # will not.
    structure = slip.salary_structure
    structure.basic += Decimal("5000")
    structure.save(update_fields=["basic"])

    assert len(render_payslip_pdf(slip)) == len(before)


@pytest.mark.django_db
def test_every_month_of_the_year_names_itself(org, structure):
    """The filename carries the month name, so all twelve have to render."""
    for month in range(1, 13):
        run = PayrollRun.objects.create(year=YEAR + 1, month=month)
        process_run(run.pk, org["hr"].user)
        approve_run(run.pk, org["admin"].user)
        slip = run.payslips.get(employee=org["employee"])

        expected = date(YEAR + 1, month, 1).strftime("%B")
        assert payslip_filename(slip) == f"AshaRao_{YEAR + 1}_{expected}.pdf"
