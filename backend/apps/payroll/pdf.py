"""Payslip PDFs.

ReportLab rather than WeasyPrint: it is pure Python, so neither the Windows
development setup nor the container build needs Cairo and Pango installed.

The layout mirrors what the portal shows on screen - the same attendance basis,
the same earnings and deductions, the same net - because a payslip that
disagrees with the page it was downloaded from is a support ticket. Every figure
comes off the ``Payslip`` row, which is a snapshot taken when the run was
processed, so re-downloading last year's payslip always produces last year's
numbers.
"""

from decimal import Decimal
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from apps.payroll.amounts import rupees_in_words
from apps.payroll.models import Payslip

# The brand palette, matching frontend/src/styles/theme.ts.
BLUE = colors.HexColor("#4A7CBE")
BLUE_SOFT = colors.HexColor("#E8F0FA")
GREEN = colors.HexColor("#8CC63F")
INK = colors.HexColor("#1F2A37")
MUTED = colors.HexColor("#6B7280")

COMPANY_NAME = "Trigyan Technologies"
COMPANY_TAGLINE = "Empowering Ideas"

# The band is brand blue, so the owl is the white cut of the mark. Its
# proportions are fixed by the artwork; recorded here so the flowable can be
# sized without opening the file.
LOGO_PATH = Path(__file__).resolve().parent / "assets" / "trigyan-mark-white.png"
LOGO_ASPECT = 316 / 480


def payslip_filename(payslip: Payslip) -> str:
    """``EmployeeName_Year_Month.pdf``, as the requirement spells it.

    Spaces come out of the name so the three parts stay readable as three
    underscore-separated tokens.
    """
    name = payslip.employee.full_name.replace(" ", "")
    return f"{name}_{payslip.run.year}_{payslip.run.get_month_display()}.pdf"


def _money(value: Decimal) -> str:
    """Indian grouping: 1,25,000.00 rather than 125,000.00."""
    quantised = Decimal(value).quantize(Decimal("0.01"))
    whole, _, fraction = f"{quantised:.2f}".partition(".")
    negative = whole.startswith("-")
    whole = whole.lstrip("-")

    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join([*groups, tail])

    return f"{'-' if negative else ''}{whole}.{fraction}"


def _styles():
    sheet = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=sheet["Title"], fontSize=18, textColor=colors.white, alignment=0
        ),
        "tagline": ParagraphStyle(
            "tagline", parent=sheet["Normal"], fontSize=9, textColor=GREEN, alignment=0
        ),
        "period": ParagraphStyle(
            "period",
            parent=sheet["Normal"],
            fontSize=11,
            textColor=colors.white,
            alignment=2,
        ),
        "heading": ParagraphStyle(
            "heading",
            parent=sheet["Heading3"],
            fontSize=10,
            textColor=BLUE,
            spaceAfter=4,
        ),
        "body": ParagraphStyle("body", parent=sheet["Normal"], fontSize=9, textColor=INK),
        "muted": ParagraphStyle("muted", parent=sheet["Normal"], fontSize=8, textColor=MUTED),
        "words": ParagraphStyle(
            "words", parent=sheet["Normal"], fontSize=9.5, textColor=INK, spaceBefore=2
        ),
    }


def _header(style) -> Table:
    """The brand band: the owl, the company, and what this document is.

    If the artwork is ever missing the band still prints - a payslip that will
    not generate is a far worse failure than one without its logo.
    """
    height = 12 * mm
    mark = (
        Image(str(LOGO_PATH), width=height * LOGO_ASPECT, height=height)
        if LOGO_PATH.exists()
        else Spacer(0, height)
    )
    left = [
        Paragraph(f"<b>{COMPANY_NAME}</b>", style["title"]),
        Paragraph(COMPANY_TAGLINE, style["tagline"]),
    ]
    table = Table(
        [[mark, left, Paragraph("<b>PAYSLIP</b>", style["period"])]],
        colWidths=[14 * mm, 96 * mm, 60 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                # The owl sits tight against the company name it belongs to.
                ("RIGHTPADDING", (0, 0), (0, 0), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def _facts(payslip: Payslip, style) -> Table:
    """Who this is for, and the attendance it was calculated on."""
    employee = payslip.employee
    rows = [
        ("Employee", employee.full_name, "Payslip for", payslip.run.period_label),
        ("Employee ID", employee.employee_code, "Working days", str(payslip.working_days)),
        (
            "Designation",
            employee.designation.name if employee.designation_id else "-",
            "Loss of pay",
            f"{payslip.lop_days} day(s)",
        ),
        (
            "Department",
            employee.department.name if employee.department_id else "-",
            "Paid days",
            f"{payslip.paid_days} day(s)",
        ),
        (
            "Date of joining",
            str(employee.date_of_joining),
            "Work location",
            employee.work_location or "-",
        ),
    ]

    data = [
        [
            Paragraph(f"<b>{label}</b>", style["body"]),
            Paragraph(str(value), style["body"]),
            Paragraph(f"<b>{right_label}</b>", style["body"]),
            Paragraph(str(right_value), style["body"]),
        ]
        for label, value, right_label, right_value in rows
    ]

    table = Table(data, colWidths=[28 * mm, 57 * mm, 28 * mm, 57 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BLUE_SOFT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _amounts(payslip: Payslip, style) -> Table:
    """Earnings beside deductions, each with its own total."""
    earnings = [
        ("Basic", payslip.basic),
        ("House rent allowance", payslip.hra),
        ("Conveyance allowance", payslip.conveyance_allowance),
        ("Medical allowance", payslip.medical_allowance),
        ("Special allowance", payslip.special_allowance),
    ]
    deductions = [
        ("Provident fund", payslip.provident_fund),
        ("Professional tax", payslip.professional_tax),
        ("Income tax (TDS)", payslip.income_tax),
        ("Other deductions", payslip.other_deductions),
        ("Loss of pay", payslip.lop_amount),
    ]

    header = [
        Paragraph("<b>Earnings</b>", style["body"]),
        Paragraph("<b>Amount</b>", style["body"]),
        Paragraph("<b>Deductions</b>", style["body"]),
        Paragraph("<b>Amount</b>", style["body"]),
    ]

    body = []
    for (earn_label, earn_value), (deduct_label, deduct_value) in zip(
        earnings, deductions, strict=True
    ):
        body.append(
            [
                Paragraph(earn_label, style["body"]),
                Paragraph(_money(earn_value), style["body"]),
                Paragraph(deduct_label, style["body"]),
                Paragraph(_money(deduct_value), style["body"]),
            ]
        )

    totals = [
        Paragraph("<b>Gross earnings</b>", style["body"]),
        Paragraph(f"<b>{_money(payslip.gross_earnings)}</b>", style["body"]),
        Paragraph("<b>Total deductions</b>", style["body"]),
        Paragraph(f"<b>{_money(payslip.total_deductions)}</b>", style["body"]),
    ]

    table = Table([header, *body, totals], colWidths=[50 * mm, 35 * mm, 50 * mm, 35 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLUE_SOFT),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, BLUE),
                ("LINEABOVE", (0, -1), (-1, -1), 0.6, BLUE),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("ALIGN", (3, 0), (3, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6DEE8")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5EAF0")),
            ]
        )
    )
    return table


def _net(payslip: Payslip, style) -> Table:
    table = Table(
        [
            [
                Paragraph("<b>NET PAY</b>", style["body"]),
                Paragraph(f"<b>{_money(payslip.net_pay)}</b>", style["body"]),
            ],
            [
                Paragraph(f"<i>{rupees_in_words(payslip.net_pay)}</i>", style["words"]),
                "",
            ],
        ],
        colWidths=[135 * mm, 35 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("SPAN", (0, 1), (1, 1)),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def render_payslip_pdf(payslip: Payslip) -> bytes:
    """The payslip as PDF bytes, ready to stream."""
    style = _styles()
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"Payslip {payslip.run.period_label} - {payslip.employee.full_name}",
        author=COMPANY_NAME,
        subject=f"Payslip for {payslip.run.period_label}",
    )

    document.build(
        [
            _header(style),
            Spacer(1, 8 * mm),
            _facts(payslip, style),
            Spacer(1, 8 * mm),
            _amounts(payslip, style),
            Spacer(1, 6 * mm),
            _net(payslip, style),
            Spacer(1, 10 * mm),
            Paragraph(
                "This is a computer-generated payslip and does not require a signature. "
                "Figures are those recorded when the payroll for this month was processed.",
                style["muted"],
            ),
        ]
    )
    return buffer.getvalue()
