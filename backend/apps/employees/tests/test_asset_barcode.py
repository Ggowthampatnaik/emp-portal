"""Reading the asset number off a barcode photo.

HR photographs the label on the back of the kit; the barcode on that label
carries the serial, so the number should never be retyped. Pinned here:

* a photo with a barcode fills an empty serial field, on create and on edit;
* a serial HR typed always beats the decoded one - the human was specific;
* a photo with no barcode degrades to the ordinary "serial required" error,
  never to a crash.
"""

from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.employees.models import EmployeeAsset


def url(employee) -> str:
    return f"/api/v1/employees/{employee.pk}/assets/"


def detail_url(employee, asset) -> str:
    return f"/api/v1/employees/{employee.pk}/assets/{asset.pk}/"


def barcode_photo(text: str = "TRG-AST-0042") -> SimpleUploadedFile:
    """A PNG whose Code128 barcode encodes ``text`` - a photographed label."""
    import zxingcpp

    barcode = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.Code128)
    image = Image.fromarray(zxingcpp.write_barcode_to_image(barcode, scale=4)).convert("RGB")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return SimpleUploadedFile("label.png", buffer.getvalue(), content_type="image/png")


def plain_photo() -> SimpleUploadedFile:
    """A photo of nothing in particular - no barcode to find."""
    buffer = BytesIO()
    Image.new("RGB", (60, 60), "#4A7CBE").save(buffer, format="PNG")
    return SimpleUploadedFile("kit.png", buffer.getvalue(), content_type="image/png")


@pytest.mark.django_db
def test_the_barcode_fills_an_empty_serial_on_create(auth_client, org):
    response = auth_client(org["hr"]).post(
        url(org["employee"]),
        {"name": "ThinkPad X1", "brand": "Lenovo", "photo": barcode_photo()},
        format="multipart",
    )

    assert response.status_code == 201, response.data
    assert response.data["serial_number"] == "TRG-AST-0042"
    assert response.data["barcode_serial"] == "TRG-AST-0042"
    assert EmployeeAsset.objects.get(serial_number="TRG-AST-0042").employee == org["employee"]


@pytest.mark.django_db
def test_a_typed_serial_beats_the_decoded_one(auth_client, org):
    response = auth_client(org["hr"]).post(
        url(org["employee"]),
        {
            "name": "ThinkPad X1",
            "brand": "Lenovo",
            "serial_number": "TYPED-001",
            "photo": barcode_photo("SOMETHING-ELSE"),
        },
        format="multipart",
    )

    assert response.status_code == 201, response.data
    assert response.data["serial_number"] == "TYPED-001"
    # The decoded value still rides back, so the UI can flag the mismatch.
    assert response.data["barcode_serial"] == "SOMETHING-ELSE"


@pytest.mark.django_db
def test_a_barcode_photo_updates_the_serial_on_an_existing_asset(auth_client, org):
    asset = EmployeeAsset.objects.create(
        employee=org["employee"], name="ThinkPad X1", brand="Lenovo", serial_number="OLD-123"
    )

    response = auth_client(org["hr"]).patch(
        detail_url(org["employee"], asset),
        {"photo": barcode_photo("TRG-AST-0099")},
        format="multipart",
    )

    assert response.status_code == 200, response.data
    asset.refresh_from_db()
    assert asset.serial_number == "TRG-AST-0099"


@pytest.mark.django_db
def test_a_photo_without_a_barcode_still_needs_a_typed_serial(auth_client, org):
    response = auth_client(org["hr"]).post(
        url(org["employee"]),
        {"name": "ThinkPad X1", "brand": "Lenovo", "photo": plain_photo()},
        format="multipart",
    )

    assert response.status_code == 400
    assert "serial_number" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_photo_survives_being_read_for_a_barcode(auth_client, org):
    """Decoding consumes the stream; a truncated saved file would 404 later."""
    response = auth_client(org["hr"]).post(
        url(org["employee"]),
        {"name": "ThinkPad X1", "brand": "Lenovo", "photo": barcode_photo()},
        format="multipart",
    )

    assert response.status_code == 201, response.data
    asset = EmployeeAsset.objects.get(serial_number="TRG-AST-0042")
    with asset.photo.open("rb") as stored:
        Image.open(stored).verify()  # decodable end to end, not zero bytes
