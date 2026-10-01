"""Importing the holiday calendar from a Word document.

HR circulates holidays as a .docx - sometimes a table, sometimes a list - and
the import has to read both without ceremony. The rules pinned here:

* a table row or a list line with a date and a name becomes a holiday;
* re-importing the same document changes nothing;
* a changed name or optional-flag is applied - the document is authoritative
  for the rows it names;
* an import never deletes: rows the document does not mention survive;
* only ``leave.manage_policy`` may import, and a non-docx is refused politely.
"""

from datetime import date
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.leave_management.models import Holiday

URL = "/api/v1/holidays/import-docx/"


def docx_table(rows: list[list[str]], header: bool = True) -> SimpleUploadedFile:
    """A real .docx with one table, the shape HR circulars actually take."""
    from docx import Document

    document = Document()
    all_rows = ([["Date", "Holiday", "Notes"]] if header else []) + rows
    table = document.add_table(rows=len(all_rows), cols=len(all_rows[0]))
    for r, row in enumerate(all_rows):
        for c, text in enumerate(row):
            table.cell(r, c).text = text
    buffer = BytesIO()
    document.save(buffer)
    return SimpleUploadedFile(
        "holidays.docx",
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


def docx_list(lines: list[str]) -> SimpleUploadedFile:
    """A .docx that is just paragraphs - the bulleted-circular shape."""
    from docx import Document

    document = Document()
    for line in lines:
        document.add_paragraph(line)
    buffer = BytesIO()
    document.save(buffer)
    return SimpleUploadedFile("holidays.docx", buffer.getvalue())


@pytest.mark.django_db
def test_a_table_of_holidays_imports(auth_client, org):
    file = docx_table(
        [
            ["14 January 2027", "Makar Sankranti", "Harvest festival; offices closed."],
            ["26/01/2027", "Republic Day", "National holiday."],
            ["1 May 2027", "Labour Day (Optional)", ""],
        ]
    )

    response = auth_client(org["hr"]).post(URL, {"file": file}, format="multipart")

    assert response.status_code == 200, response.data
    assert response.data["created"] == 3
    sankranti = Holiday.objects.get(date=date(2027, 1, 14))
    assert sankranti.name == "Makar Sankranti"
    assert sankranti.description == "Harvest festival; offices closed."
    assert Holiday.objects.get(date=date(2027, 1, 26)).name == "Republic Day"
    labour = Holiday.objects.get(date=date(2027, 5, 1))
    assert labour.is_optional is True
    assert labour.name == "Labour Day"


@pytest.mark.django_db
def test_a_plain_list_imports_with_the_year_from_the_upload(auth_client, org):
    file = docx_list(
        [
            "Company holidays",
            "14 January - Makar Sankranti",
            "15 August - Independence Day",
        ]
    )

    response = auth_client(org["hr"]).post(URL, {"file": file, "year": 2027}, format="multipart")

    assert response.status_code == 200, response.data
    assert response.data["created"] == 2
    assert Holiday.objects.filter(date=date(2027, 1, 14), name="Makar Sankranti").exists()
    assert Holiday.objects.filter(date=date(2027, 8, 15), name="Independence Day").exists()


@pytest.mark.django_db
def test_reimporting_the_same_document_changes_nothing(auth_client, org):
    rows = [["14 January 2027", "Makar Sankranti", "Harvest festival."]]
    auth_client(org["hr"]).post(URL, {"file": docx_table(rows)}, format="multipart")

    response = auth_client(org["hr"]).post(URL, {"file": docx_table(rows)}, format="multipart")

    assert response.status_code == 200, response.data
    assert response.data["created"] == 0
    assert response.data["updated"] == 0
    assert response.data["unchanged"] == 1
    assert Holiday.objects.filter(date__year=2027).count() == 1


@pytest.mark.django_db
def test_a_renamed_holiday_is_updated_in_place(auth_client, org):
    Holiday.objects.create(date=date(2027, 1, 14), name="Sankranti", description="Old copy.")

    file = docx_table([["14 January 2027", "Makar Sankranti / Pongal", ""]])
    response = auth_client(org["hr"]).post(URL, {"file": file}, format="multipart")

    assert response.status_code == 200, response.data
    assert response.data["updated"] == 1
    updated = Holiday.objects.get(date=date(2027, 1, 14))
    assert updated.name == "Makar Sankranti / Pongal"
    # A document with no description column must not blank out page copy.
    assert updated.description == "Old copy."


@pytest.mark.django_db
def test_an_import_never_deletes_a_holiday(auth_client, org):
    Holiday.objects.create(date=date(2027, 12, 25), name="Christmas Day", description="Closed.")

    file = docx_table([["14 January 2027", "Makar Sankranti", ""]])
    auth_client(org["hr"]).post(URL, {"file": file}, format="multipart")

    assert Holiday.objects.filter(date=date(2027, 12, 25)).exists()


@pytest.mark.django_db
def test_an_employee_may_not_import(auth_client, org):
    file = docx_table([["14 January 2027", "Makar Sankranti", ""]])
    response = auth_client(org["employee"]).post(URL, {"file": file}, format="multipart")

    assert response.status_code == 403
    assert not Holiday.objects.filter(date__year=2027).exists()


@pytest.mark.django_db
def test_a_file_that_is_not_a_docx_is_refused(auth_client, org):
    file = SimpleUploadedFile("holidays.docx", b"just some text", content_type="text/plain")
    response = auth_client(org["hr"]).post(URL, {"file": file}, format="multipart")

    # 409, not 500: BusinessRuleViolation is the house shape for "the domain
    # said no", and a scrambled upload must never read as a server fault.
    assert response.status_code == 409


@pytest.mark.django_db
def test_forgetting_the_file_is_a_polite_400(auth_client, org):
    response = auth_client(org["hr"]).post(URL, {}, format="multipart")

    assert response.status_code == 400


# ---------------------------------------------------------------------------
# What it refuses to open
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_oversized_upload_is_refused_before_it_is_opened(auth_client, org):
    """A .docx is a zip that python-docx inflates whole. A calendar is a few
    kilobytes; a file this size is not one, whatever it inflates to."""
    from apps.leave_management.views import MAX_IMPORT_BYTES

    too_big = SimpleUploadedFile("holidays.docx", b"x" * (MAX_IMPORT_BYTES + 1))

    response = auth_client(org["hr"]).post(URL, {"file": too_big}, format="multipart")

    assert response.status_code == 400
    assert "under 2 MB" in str(response.data)


@pytest.mark.django_db
def test_a_zip_that_inflates_out_of_all_proportion_is_refused(auth_client, org):
    """The decompression-bomb shape: small on the wire, enormous in memory."""
    import zipfile

    from apps.leave_management.views import MAX_INFLATED_BYTES

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        # Highly compressible, so the file on the wire stays tiny.
        archive.writestr("word/document.xml", b"\0" * (MAX_INFLATED_BYTES + 1))
    bomb = SimpleUploadedFile("holidays.docx", buffer.getvalue())

    response = auth_client(org["hr"]).post(URL, {"file": bomb}, format="multipart")

    assert response.status_code == 400
    assert "not a holiday calendar" in str(response.data)
