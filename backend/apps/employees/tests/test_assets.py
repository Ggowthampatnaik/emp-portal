"""Company assets issued to an employee: serial number, name, brand, photo.

Two rules carry most of this file.

*Reading* follows the visibility of the employee record itself - if you can
open somebody's profile you can see what kit they hold - so there is no
separate read permission to get out of step with the rest of the module.

*Writing* is narrower. Issuing a laptop is a custody decision, not a profile
edit, so it needs ``asset.manage`` (HR and Admin) and nothing else - an
employee cannot quietly add or remove their own hardware.
"""

from io import BytesIO

import pytest
from PIL import Image

from apps.administration.models import AuditLog
from apps.employees.models import EmployeeAsset
from common.enums import AuditAction

LAPTOP = {
    "name": "MacBook Pro 14",
    "brand": "Apple",
    "serial_number": "C02XY1234567",
}


def url(employee) -> str:
    return f"/api/v1/employees/{employee.pk}/assets/"


def detail_url(employee, asset) -> str:
    return f"/api/v1/employees/{employee.pk}/assets/{asset.pk}/"


def photo(name: str = "asset.png", size: int = 40):
    """A real PNG - ImageField rejects bytes that are not an image."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    buffer = BytesIO()
    Image.new("RGB", (size, size), "#4A7CBE").save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


@pytest.fixture
def laptop(org) -> EmployeeAsset:
    return EmployeeAsset.objects.create(employee=org["employee"], **LAPTOP)


# ---------------------------------------------------------------------------
# Issuing
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_issues_an_asset(auth_client, org):
    response = auth_client(org["hr"]).post(url(org["employee"]), LAPTOP)

    assert response.status_code == 201, response.data
    asset = EmployeeAsset.objects.get(serial_number="C02XY1234567")
    assert asset.employee == org["employee"]
    assert (asset.name, asset.brand) == ("MacBook Pro 14", "Apple")


@pytest.mark.django_db
def test_an_admin_issues_one_too(auth_client, org):
    response = auth_client(org["admin"]).post(url(org["employee"]), LAPTOP)
    assert response.status_code == 201, response.data


@pytest.mark.django_db
def test_an_employee_cannot_issue_themselves_a_laptop(auth_client, org):
    response = auth_client(org["employee"]).post(url(org["employee"]), LAPTOP)

    assert response.status_code == 403
    assert not EmployeeAsset.objects.exists()


@pytest.mark.django_db
def test_a_manager_cannot_issue_kit_to_their_own_team(auth_client, org):
    """A manager can see the record; issuing is still HR's and Admin's."""
    response = auth_client(org["manager"]).post(url(org["employee"]), LAPTOP)
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_serial_number_is_stored_upper_case(auth_client, org):
    response = auth_client(org["hr"]).post(
        url(org["employee"]), {**LAPTOP, "serial_number": "  c02xy1234567 "}
    )

    assert response.status_code == 201, response.data
    assert response.data["serial_number"] == "C02XY1234567"


@pytest.mark.django_db
def test_the_same_serial_cannot_be_out_with_two_people(auth_client, org, laptop):
    """The same physical device is not in two pairs of hands at once."""
    response = auth_client(org["hr"]).post(url(org["peer"]), LAPTOP)

    assert response.status_code == 400
    assert EmployeeAsset.objects.count() == 1


@pytest.mark.django_db
def test_the_clash_says_who_already_holds_it(auth_client, org, laptop):
    """ "Must be unique" would send HR hunting through the whole company."""
    response = auth_client(org["hr"]).post(url(org["peer"]), LAPTOP)

    message = " ".join(response.data["error"]["details"]["serial_number"])
    assert org["employee"].employee_code in message
    assert org["employee"].full_name in message


@pytest.mark.django_db
def test_lower_case_does_not_slip_a_duplicate_past(auth_client, org, laptop):
    response = auth_client(org["hr"]).post(
        url(org["peer"]), {**LAPTOP, "serial_number": "c02xy1234567"}
    )
    assert response.status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("missing", ["name", "brand", "serial_number"])
def test_the_identifying_details_are_required(auth_client, org, missing):
    payload = {key: value for key, value in LAPTOP.items() if key != missing}
    response = auth_client(org["hr"]).post(url(org["employee"]), payload)

    assert response.status_code == 400
    assert missing in response.data["error"]["details"]


# ---------------------------------------------------------------------------
# The photo
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_asset_can_be_issued_without_a_photo(auth_client, org):
    """Kit is often handed over before anyone photographs it."""
    response = auth_client(org["hr"]).post(url(org["employee"]), LAPTOP)

    assert response.status_code == 201
    assert response.data["photo_url"] is None


@pytest.mark.django_db
def test_a_photo_comes_back_as_a_url(auth_client, org):
    response = auth_client(org["hr"]).post(
        url(org["employee"]), {**LAPTOP, "photo": photo()}, format="multipart"
    )

    assert response.status_code == 201, response.data
    assert response.data["photo_url"], "the SPA has nothing to render without this"
    assert "photo" not in response.data, "the file itself is write-only"


@pytest.mark.django_db
def test_a_photo_can_be_added_later(auth_client, org, laptop):
    response = auth_client(org["hr"]).patch(
        detail_url(org["employee"], laptop), {"photo": photo()}, format="multipart"
    )

    assert response.status_code == 200, response.data
    laptop.refresh_from_db()
    assert laptop.photo


@pytest.mark.django_db
def test_a_replacement_photo_does_not_leave_the_old_file_behind(auth_client, org, laptop):
    client = auth_client(org["hr"])
    client.patch(detail_url(org["employee"], laptop), {"photo": photo("first.png")}, "multipart")
    laptop.refresh_from_db()
    first = laptop.photo.name

    client.patch(detail_url(org["employee"], laptop), {"photo": photo("second.png")}, "multipart")
    laptop.refresh_from_db()

    assert laptop.photo.name != first
    assert not laptop.photo.storage.exists(first), "the displaced file should be gone"


@pytest.mark.django_db
def test_something_that_is_not_an_image_is_refused(auth_client, org):
    from django.core.files.uploadedfile import SimpleUploadedFile

    response = auth_client(org["hr"]).post(
        url(org["employee"]),
        {**LAPTOP, "photo": SimpleUploadedFile("notes.txt", b"not an image", "text/plain")},
        format="multipart",
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Reading - follows the visibility of the record itself
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_sees_their_own_kit(auth_client, org, laptop):
    response = auth_client(org["employee"]).get(url(org["employee"]))

    assert response.status_code == 200
    assert [row["serial_number"] for row in response.data] == ["C02XY1234567"]


@pytest.mark.django_db
def test_a_manager_sees_their_teams_kit(auth_client, org, laptop):
    response = auth_client(org["manager"]).get(url(org["employee"]))

    assert response.status_code == 200
    assert len(response.data) == 1


@pytest.mark.django_db
def test_an_employee_cannot_see_a_colleagues_kit(auth_client, org, laptop):
    """Not a permission on assets - they cannot open the record at all."""
    response = auth_client(org["peer"]).get(url(org["employee"]))
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_list_is_scoped_to_the_employee_in_the_url(auth_client, org, laptop):
    EmployeeAsset.objects.create(
        employee=org["peer"], name="Dell Monitor", brand="Dell", serial_number="DM99887766"
    )

    response = auth_client(org["hr"]).get(url(org["employee"]))

    assert [row["serial_number"] for row in response.data] == ["C02XY1234567"]


# ---------------------------------------------------------------------------
# Amending and returning
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_corrects_a_detail(auth_client, org, laptop):
    response = auth_client(org["hr"]).patch(
        detail_url(org["employee"], laptop), {"brand": "Apple Inc."}
    )

    assert response.status_code == 200, response.data
    laptop.refresh_from_db()
    assert laptop.brand == "Apple Inc."


@pytest.mark.django_db
def test_editing_an_asset_does_not_trip_over_its_own_serial(auth_client, org, laptop):
    """The uniqueness check has to exclude the row being edited."""
    response = auth_client(org["hr"]).patch(
        detail_url(org["employee"], laptop), {"name": "MacBook Pro 16", **LAPTOP}
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_an_employee_cannot_amend_their_own_asset(auth_client, org, laptop):
    response = auth_client(org["employee"]).patch(
        detail_url(org["employee"], laptop), {"brand": "Something else"}
    )

    assert response.status_code == 403
    laptop.refresh_from_db()
    assert laptop.brand == "Apple"


@pytest.mark.django_db
def test_hr_takes_an_asset_back(auth_client, org, laptop):
    response = auth_client(org["hr"]).delete(detail_url(org["employee"], laptop))

    assert response.status_code == 204
    assert not EmployeeAsset.objects.filter(pk=laptop.pk).exists()


@pytest.mark.django_db
def test_an_employee_cannot_delete_their_own_asset(auth_client, org, laptop):
    response = auth_client(org["employee"]).delete(detail_url(org["employee"], laptop))

    assert response.status_code == 403
    assert EmployeeAsset.objects.filter(pk=laptop.pk).exists()


@pytest.mark.django_db
def test_an_asset_belonging_to_somebody_else_is_not_reachable(auth_client, org, laptop):
    """The employee in the URL has to be the one holding it."""
    response = auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['peer'].pk}/assets/{laptop.pk}/", {"brand": "Nope"}
    )

    assert response.status_code == 404
    laptop.refresh_from_db()
    assert laptop.brand == "Apple"


# ---------------------------------------------------------------------------
# The audit trail
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_issuing_and_returning_are_both_recorded(auth_client, org):
    client = auth_client(org["hr"])
    created = client.post(url(org["employee"]), LAPTOP)
    asset = EmployeeAsset.objects.get(pk=created.data["id"])
    client.delete(detail_url(org["employee"], asset))

    actions = list(
        AuditLog.objects.filter(entity_label__icontains="C02XY1234567").values_list(
            "action", flat=True
        )
    )
    assert AuditAction.CREATE in actions
    assert AuditAction.DELETE in actions


@pytest.mark.django_db
def test_the_asset_is_gone_when_the_employee_record_is(org, laptop):
    """Kit records hang off the person; nothing else points at them."""
    org["employee"].delete()

    assert not EmployeeAsset.objects.filter(pk=laptop.pk).exists()


# ---------------------------------------------------------------------------
# The admin Assets page: everyone, with what they hold
# ---------------------------------------------------------------------------
# The page lists every employee and shows a count against each, then fetches
# the assets themselves when a row is expanded. The count has to come off the
# list query - one number per row, not one request per row.
@pytest.mark.django_db
def test_the_employee_list_carries_an_asset_count(auth_client, org, laptop):
    response = auth_client(org["hr"]).get("/api/v1/employees/", {"page_size": 100})

    assert response.status_code == 200
    counts = {row["employee_code"]: row["asset_count"] for row in response.data["results"]}
    assert counts[org["employee"].employee_code] == 1
    assert counts[org["peer"].employee_code] == 0, "somebody with nothing still appears"


@pytest.mark.django_db
def test_the_count_does_not_cost_a_query_per_employee(
    auth_client, org, django_assert_max_num_queries
):
    """Annotated, not looked up row by row - otherwise the page degrades as the
    company grows, which is exactly when it starts being useful."""
    from apps.employees.models import EmployeeAsset

    for index in range(6):
        EmployeeAsset.objects.create(
            employee=org["employee"],
            name=f"Device {index}",
            brand="Acme",
            serial_number=f"BULK-{index:04d}",
        )

    client = auth_client(org["hr"])
    with django_assert_max_num_queries(12):
        response = client.get("/api/v1/employees/", {"page_size": 100})

    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["employee_code"] == "TRG0005")
    assert row["asset_count"] == 6


@pytest.mark.django_db
def test_searching_narrows_the_list_the_page_shows(auth_client, org, laptop):
    """The page's search box is the employee list's own `?search=`."""
    response = auth_client(org["hr"]).get("/api/v1/employees/", {"search": "Asha"})

    assert response.status_code == 200
    assert [row["employee_code"] for row in response.data["results"]] == ["TRG0005"]
    assert response.data["results"][0]["asset_count"] == 1


@pytest.mark.django_db
def test_the_skills_filter_does_not_inflate_the_count(auth_client, org, laptop, django_user_model):
    """Chained joins can multiply rows; `distinct` is what stops the same
    laptop being counted once per matching skill."""
    from apps.employees.models import EmployeeSkill, Skill

    for name in ("Python", "React"):
        skill, _ = Skill.objects.get_or_create(name=name, defaults={"category": "technical"})
        EmployeeSkill.objects.create(employee=org["employee"], skill=skill)

    ids = ",".join(str(s.pk) for s in Skill.objects.filter(name__in=["Python", "React"]))
    response = auth_client(org["hr"]).get("/api/v1/employees/", {"skills": ids})

    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["employee_code"] == "TRG0005")
    assert row["asset_count"] == 1, "one laptop, however many skills matched"


@pytest.mark.django_db
def test_my_team_still_works_without_the_annotation(auth_client, org):
    """It reuses the list serializer without annotating, so the count says
    "not counted here" rather than claiming a zero nobody measured."""
    response = auth_client(org["manager"]).get("/api/v1/employees/my-team/")

    assert response.status_code == 200
    assert all(row["asset_count"] is None for row in response.data)
