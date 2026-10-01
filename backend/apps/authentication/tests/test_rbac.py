"""Role hierarchy and permission-code enforcement."""

import pytest

from apps.authentication.models import ModulePermission, Role
from common.enums import RoleSlug


@pytest.mark.django_db
def test_seed_rbac_creates_every_portal_role(seeded_rbac):
    """Six since Finance was split out of Payroll in Phase 5."""
    assert set(seeded_rbac) == set(RoleSlug.values)
    assert Role.objects.filter(is_system=True).count() == len(RoleSlug.values)
    assert ModulePermission.objects.count() >= 30


@pytest.mark.django_db
def test_seed_rbac_is_idempotent(seeded_rbac):
    from django.core.management import call_command

    before = (Role.objects.count(), ModulePermission.objects.count())
    call_command("seed_rbac", verbosity=0)
    assert (Role.objects.count(), ModulePermission.objects.count()) == before


@pytest.mark.django_db
def test_employee_cannot_approve_leave(employee_user):
    assert employee_user.has_module_permission("leave.apply")
    assert not employee_user.has_module_permission("leave.approve")
    assert not employee_user.is_privileged


@pytest.mark.django_db
def test_manager_can_approve_leave_and_timesheets(manager_user):
    assert manager_user.has_module_permission("leave.approve")
    assert manager_user.has_module_permission("timesheet.approve")
    assert not manager_user.has_module_permission("admin.manage_roles")


@pytest.mark.django_db
def test_hr_owns_leave_policy_but_not_role_management(hr_user):
    assert hr_user.has_module_permission("leave.manage_policy")
    assert hr_user.has_module_permission("employee.create")
    assert not hr_user.has_module_permission("admin.manage_roles")
    assert hr_user.is_privileged


@pytest.mark.django_db
def test_super_admin_bypasses_every_permission_check(super_admin_user):
    assert super_admin_user.is_super_admin
    assert super_admin_user.has_module_permission("anything.not.seeded")


@pytest.mark.django_db
def test_current_user_endpoint_returns_roles_and_permissions(auth_client, manager_user):
    response = auth_client(manager_user).get("/api/v1/auth/me/")
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "manager@trigyan.io"
    assert set(body["roles"]) == {"employee", "manager"}
    assert "leave.approve" in body["permissions"]


@pytest.mark.django_db
def test_entra_exchange_requires_a_token(api_client):
    response = api_client.post("/api/v1/auth/entra/exchange/", {})
    assert response.status_code == 401
