"""Employee directory: visibility scoping, self-service limits, org chart."""

import pytest

from apps.administration.models import AuditLog
from apps.employees.models import Employee
from common.enums import EmploymentStatus, RoleSlug


# ---------------------------------------------------------------------------
# Visibility
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_sees_only_themselves(auth_client, org):
    response = auth_client(org["employee"]).get("/api/v1/employees/")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["employee_code"] == "TRG0005"


@pytest.mark.django_db
def test_a_manager_sees_their_branch(auth_client, org):
    response = auth_client(org["manager"]).get("/api/v1/employees/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert codes == {"TRG0004", "TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_a_manager_sees_indirect_reports_too(auth_client, org, make_user, make_employee):
    """A branch is the whole subtree, not just direct reports."""
    junior = make_employee(
        make_user("ananya.gupta@trigyan.io"), manager=org["employee"], employee_code="TRG0013"
    )
    response = auth_client(org["manager"]).get("/api/v1/employees/")
    codes = {row["employee_code"] for row in response.data["results"]}
    assert junior.employee_code in codes


@pytest.mark.django_db
def test_hr_sees_the_whole_organization(auth_client, org):
    response = auth_client(org["hr"]).get("/api/v1/employees/")
    assert response.data["count"] == Employee.objects.count()


@pytest.mark.django_db
def test_an_employee_cannot_open_another_record(auth_client, org):
    response = auth_client(org["employee"]).get(f"/api/v1/employees/{org['outsider'].pk}/")
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_me_returns_the_callers_own_profile(auth_client, org):
    response = auth_client(org["employee"]).get("/api/v1/employees/me/")
    assert response.status_code == 200
    assert response.data["employee_code"] == "TRG0005"
    assert response.data["email"] == "asha.rao@trigyan.io"
    assert response.data["reporting_manager_name"] == "Vikram Nair"


@pytest.mark.django_db
def test_my_team_lists_direct_reports(auth_client, org):
    response = auth_client(org["manager"]).get("/api/v1/employees/my-team/")
    codes = {row["employee_code"] for row in response.data}
    assert codes == {"TRG0005", "TRG0006"}


# ---------------------------------------------------------------------------
# Self-service editing
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_may_update_their_contact_details(auth_client, org):
    response = auth_client(org["employee"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/",
        {
            "phone": "+91 90000 11111",
            "permanent_address": "12 Jubilee Hills, Hyderabad",
            "current_address": "4B Koramangala, Bengaluru",
        },
    )
    assert response.status_code == 200, response.data
    assert response.data["phone"] == "+91 90000 11111"
    assert response.data["permanent_address"] == "12 Jubilee Hills, Hyderabad"
    assert response.data["current_address"] == "4B Koramangala, Bengaluru"


@pytest.mark.django_db
def test_an_employee_may_not_change_their_own_department(auth_client, org, department):
    response = auth_client(org["employee"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/", {"department": department.pk}
    )
    assert response.status_code == 403
    assert "contact and personal details" in response.data["error"]["message"]


@pytest.mark.django_db
def test_hr_may_change_employment_fields(auth_client, org, designation):
    response = auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/",
        {"designation": designation.pk, "work_location": "Bengaluru"},
    )
    assert response.status_code == 200, response.data
    assert response.data["work_location"] == "Bengaluru"


@pytest.mark.django_db
def test_reporting_cycles_are_refused(auth_client, org):
    """The manager cannot be made to report to their own report."""
    response = auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['manager'].pk}/",
        {"reporting_manager": org["employee"].pk},
    )
    assert response.status_code == 400
    assert "cycle" in str(response.data["error"]["details"]).lower()


@pytest.mark.django_db
def test_an_employee_cannot_report_to_themselves(auth_client, org):
    response = auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/",
        {"reporting_manager": org["employee"].pk},
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Onboarding and offboarding
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_hr_onboards_an_employee_with_an_account(auth_client, org, department, designation):
    response = auth_client(org["hr"]).post(
        "/api/v1/employees/",
        {
            "employee_code": "TRG0099",
            "first_name": "Nikhil",
            "last_name": "Verma",
            "email": "nikhil.verma@trigyan.io",
            "temporary_password": "Welcome@2026",
            "department": department.pk,
            "designation": designation.pk,
            "reporting_manager": org["manager"].pk,
            "date_of_joining": "2026-01-05",
            "roles": ["employee"],
        },
    )
    assert response.status_code == 201, response.data

    employee = Employee.objects.get(employee_code="TRG0099")
    assert employee.user.email == "nikhil.verma@trigyan.io"
    assert employee.user.must_change_password is True
    assert employee.user.check_password("Welcome@2026")
    assert sorted(employee.user.role_slugs) == ["employee"]


@pytest.mark.django_db
def test_onboarding_rejects_a_duplicate_email(auth_client, org, department):
    response = auth_client(org["hr"]).post(
        "/api/v1/employees/",
        {
            "employee_code": "TRG0098",
            "first_name": "Asha",
            "last_name": "Clone",
            "email": "asha.rao@trigyan.io",
            "temporary_password": "Welcome@2026",
            "date_of_joining": "2026-01-05",
        },
    )
    assert response.status_code == 400
    assert "email" in response.data["error"]["details"]


@pytest.mark.django_db
def test_an_employee_cannot_onboard_anyone(auth_client, org):
    response = auth_client(org["employee"]).post(
        "/api/v1/employees/",
        {
            "employee_code": "TRG0097",
            "first_name": "Nope",
            "last_name": "Nope",
            "email": "nope@trigyan.io",
            "temporary_password": "Welcome@2026",
            "date_of_joining": "2026-01-05",
        },
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_deleting_an_employee_deactivates_instead(auth_client, org):
    target = org["peer"]
    response = auth_client(org["hr"]).delete(f"/api/v1/employees/{target.pk}/")
    assert response.status_code == 204

    target.refresh_from_db()
    target.user.refresh_from_db()
    assert target.employment_status == EmploymentStatus.INACTIVE
    assert target.user.is_active is False
    assert Employee.objects.filter(pk=target.pk).exists()  # history preserved


# ---------------------------------------------------------------------------
# Org chart and audit
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_org_chart_nests_reports_under_managers(auth_client, org):
    response = auth_client(org["hr"]).get("/api/v1/employees/org-chart/")
    assert response.status_code == 200

    manager_node = next(
        node for node in _flatten(response.data) if node["employee_code"] == "TRG0004"
    )
    report_codes = {child["employee_code"] for child in manager_node["reports"]}
    assert report_codes == {"TRG0005", "TRG0006"}


def _flatten(nodes: list[dict]) -> list[dict]:
    out = []
    for node in nodes:
        out.append(node)
        out.extend(_flatten(node.get("reports", [])))
    return out


@pytest.mark.django_db
def test_changes_are_written_to_the_audit_trail(auth_client, org):
    auth_client(org["hr"]).patch(
        f"/api/v1/employees/{org['employee'].pk}/", {"work_location": "Pune"}
    )
    entry = AuditLog.objects.filter(entity_type="Employee", action="update").first()
    assert entry is not None
    assert entry.actor_email == "priya.menon@trigyan.io"
    assert entry.request_id


# ---------------------------------------------------------------------------
# Optional profile documents
# ---------------------------------------------------------------------------
# Certificates and experience letters are the employee's own to attach after
# onboarding. Being able to attach one but not take it away again makes the
# section unusable the first time somebody uploads the wrong file.
@pytest.mark.django_db
def test_an_employee_removes_a_document_they_attached(auth_client, org):
    from django.core.files.uploadedfile import SimpleUploadedFile

    client = auth_client(org["employee"])
    uploaded = client.post(
        f"/api/v1/employees/{org['employee'].pk}/documents/",
        {
            "document_type": "tenth",
            "title": "10th mark sheet",
            "file": SimpleUploadedFile("tenth.pdf", b"%PDF-1.4 marks", "application/pdf"),
        },
        format="multipart",
    )
    assert uploaded.status_code == 201, uploaded.data

    removed = client.delete(
        f"/api/v1/employees/{org['employee'].pk}/documents/{uploaded.data['id']}/"
    )
    assert removed.status_code == 204


@pytest.mark.django_db
def test_an_employee_cannot_remove_a_colleagues_document(auth_client, org):
    from apps.employees.models import EmployeeDocument

    document = EmployeeDocument.objects.create(
        employee=org["employee"],
        document_type="tenth",
        title="10th mark sheet",
        file="employee-documents/x.pdf",
    )

    response = auth_client(org["peer"]).delete(
        f"/api/v1/employees/{org['employee'].pk}/documents/{document.pk}/"
    )

    assert response.status_code in (403, 404)
    assert EmployeeDocument.objects.filter(pk=document.pk).exists()


# ---------------------------------------------------------------------------
# Profile documents are PDFs
# ---------------------------------------------------------------------------
# The upload control can only suggest a file type; a caller posting straight at
# the API picks its own filename and content type. So the check that counts is
# the first five bytes, which is the one part of a file its name cannot lie
# about.
def pdf(name: str = "certificate.pdf", body: bytes = b"%PDF-1.4 a real document"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, body, content_type="application/pdf")


def upload(client, employee, **overrides):
    payload = {"document_type": "tenth", "title": "10th certificate", "file": pdf()}
    payload.update(overrides)
    return client.post(f"/api/v1/employees/{employee.pk}/documents/", payload, format="multipart")


@pytest.mark.django_db
def test_an_employee_uploads_a_pdf_to_their_own_profile(auth_client, org):
    response = upload(auth_client(org["employee"]), org["employee"])

    assert response.status_code == 201, response.data
    assert response.data["title"] == "10th certificate"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "kind",
    ["tenth", "intermediate", "bachelors", "masters", "skill_certificate", "other"],
)
def test_every_category_the_form_offers_is_accepted(auth_client, org, kind):
    response = upload(
        auth_client(org["employee"]), org["employee"], document_type=kind, title=f"My {kind}"
    )
    assert response.status_code == 201, response.data


@pytest.mark.django_db
def test_a_renamed_image_is_not_a_pdf(auth_client, org):
    """The extension and content type both say PDF; the bytes do not."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    disguised = SimpleUploadedFile(
        "certificate.pdf", b"\x89PNG\r\n\x1a\n not a pdf", content_type="application/pdf"
    )
    response = upload(auth_client(org["employee"]), org["employee"], file=disguised)

    assert response.status_code == 400
    assert "file" in response.data["error"]["details"]


@pytest.mark.django_db
def test_a_word_document_is_refused(auth_client, org):
    from django.core.files.uploadedfile import SimpleUploadedFile

    response = upload(
        auth_client(org["employee"]),
        org["employee"],
        file=SimpleUploadedFile("cv.docx", b"PK\x03\x04 zip", content_type="application/msword"),
    )

    assert response.status_code == 400
    assert "PDF" in " ".join(response.data["error"]["details"]["file"])


@pytest.mark.django_db
def test_an_oversized_file_is_refused(auth_client, org):
    from django.core.files.uploadedfile import SimpleUploadedFile

    big = SimpleUploadedFile(
        "huge.pdf", b"%PDF-" + b"0" * (11 * 1024 * 1024), content_type="application/pdf"
    )
    response = upload(auth_client(org["employee"]), org["employee"], file=big)

    assert response.status_code == 400
    assert "MB" in " ".join(response.data["error"]["details"]["file"])


@pytest.mark.django_db
def test_a_document_needs_a_name(auth_client, org):
    response = upload(auth_client(org["employee"]), org["employee"], title="   ")

    assert response.status_code == 400
    assert "title" in response.data["error"]["details"]


@pytest.mark.django_db
def test_the_refused_upload_stored_nothing(auth_client, org):
    from django.core.files.uploadedfile import SimpleUploadedFile

    from apps.employees.models import EmployeeDocument

    upload(
        auth_client(org["employee"]),
        org["employee"],
        file=SimpleUploadedFile("x.pdf", b"nope", content_type="application/pdf"),
    )

    assert not EmployeeDocument.objects.filter(employee=org["employee"]).exists()


@pytest.mark.django_db
def test_a_validated_pdf_is_still_saved_whole(auth_client, org):
    """Reading the first bytes to check them must not consume the file."""
    from apps.employees.models import EmployeeDocument

    body = b"%PDF-1.4 the whole document, every byte of it"
    response = upload(auth_client(org["employee"]), org["employee"], file=pdf(body=body))

    assert response.status_code == 201, response.data
    saved = EmployeeDocument.objects.get(pk=response.data["id"])
    assert saved.file.size == len(body), "the file was truncated by the magic-byte read"
    assert saved.file_size == len(body)


@pytest.mark.django_db
def test_uploaded_documents_come_back_on_the_profile(auth_client, org):
    client = auth_client(org["employee"])
    upload(client, org["employee"], title="My 10th certificate")

    listed = client.get(f"/api/v1/employees/{org['employee'].pk}/documents/")

    assert listed.status_code == 200
    assert [row["title"] for row in listed.data] == ["My 10th certificate"]
    assert listed.data[0]["file_url"], "the profile needs something to link to"


@pytest.mark.django_db
def test_the_org_chart_carries_a_photo_for_each_node(auth_client, org):
    """The chart is read by recognising faces before names, so the photo rides
    with the node rather than costing a lookup per card."""
    response = auth_client(org["hr"]).get("/api/v1/employees/org-chart/")

    assert response.status_code == 200

    def walk(nodes):
        for node in nodes:
            assert "photo_url" in node, f"{node['full_name']} has no photo_url"
            walk(node["reports"])

    assert response.data, "the fixture should produce a tree"
    walk(response.data)


@pytest.mark.django_db
def test_onboarding_cannot_hand_out_super_admin(auth_client, org, department):
    """`employee.create` must never be a back door past every permission check:
    Super Admin is granted from Administration, by a Super Admin, and nowhere else."""
    response = auth_client(org["hr"]).post(
        "/api/v1/employees/",
        {
            "employee_code": "TRG0097",
            "first_name": "Root",
            "last_name": "Kit",
            "email": "root.kit@trigyan.io",
            "temporary_password": "Welcome@2026",
            "department": department.pk,
            "date_of_joining": "2026-01-05",
            "roles": ["employee", "super_admin"],
        },
    )
    assert response.status_code == 400, response.data
    assert "roles" in response.data["error"]["details"]
    assert not Employee.objects.filter(employee_code="TRG0097").exists()


@pytest.mark.django_db
def test_the_list_can_leave_the_caller_out(auth_client, org):
    """The Employees page is where you look somebody else up; your own record
    is under My profile. Excluded server-side so the count stays honest."""
    everyone = auth_client(org["hr"]).get("/api/v1/employees/")
    without_me = auth_client(org["hr"]).get("/api/v1/employees/", {"exclude_self": "1"})

    codes = {row["employee_code"] for row in without_me.data["results"]}
    assert org["hr"].employee_code not in codes
    assert org["employee"].employee_code in codes
    # The count follows the rows, so the pager and the "N employees" line agree.
    assert without_me.data["count"] == everyone.data["count"] - 1


@pytest.mark.django_db
def test_the_list_still_carries_the_caller_by_default(auth_client, org):
    """Opt-in only: the same endpoint feeds the org chart and the reports,
    where everybody belongs."""
    response = auth_client(org["hr"]).get("/api/v1/employees/")

    codes = {row["employee_code"] for row in response.data["results"]}
    assert org["hr"].employee_code in codes


@pytest.mark.django_db
def test_excluding_yourself_is_harmless_without_an_employee_record(auth_client, make_user):
    """An account with no employment record has nothing to exclude."""
    user = make_user("standalone@trigyan.io", RoleSlug.EMPLOYEE)

    response = auth_client(user).get("/api/v1/employees/", {"exclude_self": "1"})

    assert response.status_code == 200
