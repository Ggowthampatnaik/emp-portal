"""Profile photo upload, blood group, and the renamed current address."""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.employees.photo import MAX_PHOTO_BYTES


def make_image(name: str = "avatar.png", size: tuple[int, int] = (120, 120), fmt: str = "PNG"):
    """A real image file - ImageField rejects anything that will not decode."""
    buffer = io.BytesIO()
    Image.new("RGB", size, (107, 155, 214)).save(buffer, format=fmt)
    buffer.seek(0)
    return SimpleUploadedFile(
        name, buffer.read(), content_type=f"image/{'jpeg' if fmt == 'JPEG' else fmt.lower()}"
    )


@pytest.mark.django_db
def test_an_employee_uploads_their_own_photo(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    employee = org["employee"]

    response = auth_client(employee).post(
        f"/api/v1/employees/{employee.pk}/photo/",
        {"photo": make_image()},
        format="multipart",
    )
    assert response.status_code == 200, response.data
    assert response.data["photo_url"]

    employee.refresh_from_db()
    assert employee.photo.name.startswith("employee-photos/")


@pytest.mark.django_db
def test_the_photo_url_appears_on_the_profile(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    employee = org["employee"]
    client = auth_client(employee)
    client.post(
        f"/api/v1/employees/{employee.pk}/photo/", {"photo": make_image()}, format="multipart"
    )

    response = client.get("/api/v1/employees/me/")
    assert response.status_code == 200
    assert response.data["photo_url"] is not None


@pytest.mark.django_db
def test_an_employee_cannot_set_someone_elses_photo(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    response = auth_client(org["employee"]).post(
        f"/api/v1/employees/{org['peer'].pk}/photo/",
        {"photo": make_image()},
        format="multipart",
    )
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_hr_may_set_any_employees_photo(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    response = auth_client(org["hr"]).post(
        f"/api/v1/employees/{org['employee'].pk}/photo/",
        {"photo": make_image()},
        format="multipart",
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_a_non_image_upload_is_refused(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    fake = SimpleUploadedFile(
        "resume.pdf", b"%PDF-1.4 not an image", content_type="application/pdf"
    )
    response = auth_client(org["employee"]).post(
        f"/api/v1/employees/{org['employee'].pk}/photo/", {"photo": fake}, format="multipart"
    )
    assert response.status_code == 400
    assert "photo" in response.data["error"]["details"]


@pytest.mark.django_db
def test_an_oversized_photo_is_refused(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    oversized = SimpleUploadedFile(
        "huge.png", b"x" * (MAX_PHOTO_BYTES + 1), content_type="image/png"
    )
    response = auth_client(org["employee"]).post(
        f"/api/v1/employees/{org['employee'].pk}/photo/", {"photo": oversized}, format="multipart"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_uploading_again_replaces_the_previous_file(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    employee = org["employee"]
    client = auth_client(employee)

    client.post(
        f"/api/v1/employees/{employee.pk}/photo/",
        {"photo": make_image("first.png")},
        format="multipart",
    )
    employee.refresh_from_db()
    first_path = employee.photo.path

    client.post(
        f"/api/v1/employees/{employee.pk}/photo/",
        {"photo": make_image("second.png")},
        format="multipart",
    )
    employee.refresh_from_db()

    assert employee.photo.path != first_path
    assert not (tmp_path / first_path).exists()  # the old file is gone


@pytest.mark.django_db
def test_removing_the_photo(auth_client, org, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    employee = org["employee"]
    client = auth_client(employee)
    client.post(
        f"/api/v1/employees/{employee.pk}/photo/", {"photo": make_image()}, format="multipart"
    )

    response = client.delete(f"/api/v1/employees/{employee.pk}/photo/")
    assert response.status_code == 204

    employee.refresh_from_db()
    assert not employee.photo


# ---------------------------------------------------------------------------
# Blood group and the renamed address
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_may_set_their_blood_group_and_current_address(auth_client, org):
    response = auth_client(org["employee"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/",
        {"blood_group": "O+", "current_address": "4B Koramangala, Bengaluru"},
    )
    assert response.status_code == 200, response.data
    assert response.data["blood_group"] == "O+"
    assert response.data["current_address"] == "4B Koramangala, Bengaluru"


@pytest.mark.django_db
def test_an_invalid_blood_group_is_refused(auth_client, org):
    response = auth_client(org["employee"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/", {"blood_group": "Z+"}
    )
    assert response.status_code == 400
    assert "blood_group" in response.data["error"]["details"]
