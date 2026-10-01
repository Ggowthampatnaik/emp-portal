"""CSV cells that cannot turn into formulas.

A spreadsheet reads a cell beginning with = + - @ as a formula whatever the
CSV thought it was. The exports carry names typed by people, so the guard is
pinned here on its own, and once through a real export below.
"""

from decimal import Decimal

import pytest

from common.spreadsheet import safe_cell, safe_row


@pytest.mark.parametrize(
    ("raw", "written"),
    [
        pytest.param(
            '=HYPERLINK("http://x","Open")', '\'=HYPERLINK("http://x","Open")', id="hyperlink"
        ),
        pytest.param("=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0", id="dde"),
        pytest.param("+1 (555) 0100", "'+1 (555) 0100", id="plus"),
        pytest.param("-Priya", "'-Priya", id="minus"),
        pytest.param("@channel", "'@channel", id="at"),
        pytest.param("\tindented", "'\tindented", id="tab"),
        pytest.param("Priya Menon", "Priya Menon", id="ordinary name"),
        pytest.param("", "", id="empty"),
    ],
)
def test_risky_text_is_quoted(raw, written):
    assert safe_cell(raw) == written


@pytest.mark.parametrize("number", [0, -12, 3.5, Decimal("-4500.00"), True])
def test_numbers_pass_through_untouched(number):
    """A negative amount starts with '-' and must stay a number."""
    assert safe_cell(number) is number


def test_none_stays_none():
    assert safe_cell(None) is None


def test_a_row_is_guarded_cell_by_cell():
    assert safe_row(["TRG0005", "=SUM(A1)", Decimal("-1.00")]) == [
        "TRG0005",
        "'=SUM(A1)",
        Decimal("-1.00"),
    ]
    assert safe_row({"employee": "@here", "hours": 8}) == {"employee": "'@here", "hours": 8}
