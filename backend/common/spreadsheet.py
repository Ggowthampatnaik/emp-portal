"""CSV cells that stay text when the file is opened in a spreadsheet.

A cell beginning with ``=``, ``+``, ``-`` or ``@`` is a formula to Excel and
LibreOffice, whatever the file that carried it thought it was. A name entered
as ``=HYPERLINK("http://…","Open")`` runs the moment Finance opens the payroll
sheet; the classic ``=cmd|' /C calc'!A0`` does worse. Tab and carriage return
are prefixes that some versions treat the same way.

The defence is the standard one: prefix such a cell with a single quote, which
spreadsheets read as "this is text" and drop from the display. Numbers are
left alone - a negative amount starts with ``-`` and must stay a number.
"""

from decimal import Decimal

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    """The value as it should be written: numbers untouched, risky text quoted."""
    if value is None or isinstance(value, (int, float, Decimal, bool)):
        return value
    text = str(value)
    if text.startswith(FORMULA_PREFIXES):
        return "'" + text
    return text


def safe_row(row):
    """``safe_cell`` over a list of cells, or over the values of a dict row."""
    if isinstance(row, dict):
        return {key: safe_cell(value) for key, value in row.items()}
    return [safe_cell(value) for value in row]
