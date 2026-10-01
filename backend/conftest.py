"""Shared pytest fixtures."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.authentication.models import Role, User
from apps.authentication.views import issue_token_pair
from apps.employees.models import Department, Designation, Employee
from apps.leave_management.models import LeaveType
from apps.projects.models import Project, ProjectAllocation, ProjectMember
from common.enums import LeaveStatus, RoleSlug

PASSWORD = "Fixture@123"


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def seeded_rbac(db):
    """Roles and permissions, exactly as a deployed environment has them."""
    from django.core.management import call_command

    call_command("seed_rbac", verbosity=0)
    return {role.slug: role for role in Role.objects.all()}


@pytest.fixture
def make_user(db, seeded_rbac):
    def _make(email: str, *roles: str, password: str = PASSWORD) -> User:
        first, _, last = email.split("@")[0].partition(".")
        user = User.objects.create_user(
            email=email,
            password=password,
            first_name=first.title(),
            last_name=(last or "User").title(),
        )
        for slug in roles or (RoleSlug.EMPLOYEE,):
            user.user_roles.create(role=seeded_rbac[slug])
        return user

    return _make


# Bare accounts (no employment record) for permission-logic tests.
@pytest.fixture
def employee_user(make_user) -> User:
    return make_user("employee@trigyan.io", RoleSlug.EMPLOYEE)


@pytest.fixture
def manager_user(make_user) -> User:
    return make_user("manager@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.MANAGER)


@pytest.fixture
def hr_user(make_user) -> User:
    return make_user("hr@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.HR)


@pytest.fixture
def super_admin_user(make_user) -> User:
    return make_user("root@trigyan.io", RoleSlug.SUPER_ADMIN)


@pytest.fixture
def department(db) -> Department:
    return Department.objects.create(code="ENG", name="Engineering")


@pytest.fixture
def designation(db) -> Designation:
    return Designation.objects.create(code="SE", name="Software Engineer", level=2)


@pytest.fixture
def make_employee(db, department, designation):
    """Creates an employment record for a user."""
    counter = {"n": 0}

    def _make(user: User, manager: Employee | None = None, **overrides) -> Employee:
        counter["n"] += 1
        return Employee.objects.create(
            user=user,
            employee_code=overrides.pop("employee_code", f"TST{counter['n']:04d}"),
            department=overrides.pop("department", department),
            designation=overrides.pop("designation", designation),
            reporting_manager=manager,
            date_of_joining=overrides.pop("date_of_joining", date(2022, 1, 3)),
            # Established staff, not somebody mid-onboarding: the Complete
            # Profile gate (F18) is opted into explicitly where it is the
            # subject of the test.
            profile_completed=overrides.pop("profile_completed", True),
            **overrides,
        )

    return _make


# ---------------------------------------------------------------------------
# A small organization: hr / manager / two reports / an unrelated employee
# ---------------------------------------------------------------------------
@pytest.fixture
def org(make_user, make_employee):
    hr_user = make_user("priya.menon@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.HR)
    manager_user = make_user("vikram.nair@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.MANAGER)
    employee_user = make_user("asha.rao@trigyan.io", RoleSlug.EMPLOYEE)
    peer_user = make_user("karthik.reddy@trigyan.io", RoleSlug.EMPLOYEE)
    outsider_user = make_user("rohan.desai@trigyan.io", RoleSlug.EMPLOYEE)
    admin_user = make_user("rahul.iyer@trigyan.io", RoleSlug.EMPLOYEE, RoleSlug.ADMIN)

    hr = make_employee(hr_user, employee_code="TRG0002")
    manager = make_employee(manager_user, employee_code="TRG0004")
    employee = make_employee(employee_user, manager=manager, employee_code="TRG0005")
    peer = make_employee(peer_user, manager=manager, employee_code="TRG0006")
    outsider = make_employee(outsider_user, employee_code="TRG0012")
    admin = make_employee(admin_user, employee_code="TRG0003")

    return {
        "hr": hr,
        "manager": manager,
        "employee": employee,
        "peer": peer,
        "outsider": outsider,
        "admin": admin,
    }


@pytest.fixture
def auth_client(api_client):
    """Returns a client carrying a real portal JWT for the given user."""

    def _login(user_or_employee) -> APIClient:
        user = getattr(user_or_employee, "user", user_or_employee)
        tokens = issue_token_pair(user)
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return api_client

    return _login


# ---------------------------------------------------------------------------
# Leave and project fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def leave_type(db) -> LeaveType:
    return LeaveType.objects.create(
        code="EL", name="Earned Leave", days_per_year=Decimal("18.0"), is_paid=True
    )


@pytest.fixture
def short_leave_type(db) -> LeaveType:
    return LeaveType.objects.create(
        code="CL",
        name="Casual Leave",
        days_per_year=Decimal("3.0"),
        max_consecutive_days=2,
        allow_half_day=False,
    )


@pytest.fixture
def small_quota_leave_type(db) -> LeaveType:
    """Three days a year and no per-request cap, so quota is the binding limit."""
    return LeaveType.objects.create(
        code="LOP", name="Loss of Pay", days_per_year=Decimal("3.0"), is_paid=False
    )


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------
#: A month with no holidays seeded: 22 working days (1-31 July, Mon-Fri).
PAYROLL_YEAR, PAYROLL_MONTH = 2025, 7


@pytest.fixture
def structure(db, org):
    """A round salary so the arithmetic in assertions stays readable."""
    from apps.payroll.models import SalaryStructure

    return SalaryStructure.objects.create(
        employee=org["employee"],
        effective_from=date(2024, 1, 1),
        basic=Decimal("40000"),
        hra=Decimal("20000"),
        conveyance_allowance=Decimal("2000"),
        medical_allowance=Decimal("2000"),
        special_allowance=Decimal("6000"),
        provident_fund=Decimal("4800"),
        professional_tax=Decimal("200"),
        income_tax=Decimal("5000"),
    )


@pytest.fixture
def run(db):
    """The payroll month those tests work in - see PAYROLL_YEAR / PAYROLL_MONTH."""
    from apps.payroll.models import PayrollRun

    return PayrollRun.objects.create(year=PAYROLL_YEAR, month=PAYROLL_MONTH)


@pytest.fixture
def unpaid_leave_type(db):
    return LeaveType.objects.create(
        code="LOP", name="Loss of Pay", days_per_year=Decimal("30.0"), is_paid=False
    )


@pytest.fixture
def book_past_leave():
    """Creates a leave request for a period that has already happened.

    Applying for leave in the past is refused - leave is asked for, not
    reported. But leave *in* the past exists in quantity: it was applied for in
    advance and the days came and went, which is exactly what payroll reads
    when it works out loss of pay for last month.

    So this builds the row the way time would have left it, reserving the
    balance the same way `apply_for_leave` does, and leaves it pending so the
    ordinary approval services can take it the rest of the way.
    """
    from apps.leave_management.models import LeaveRequest
    from apps.leave_management.services import count_leave_days, get_or_create_balance

    def _book(employee, leave_type, start, end, reason="Booked before the fact."):
        days = count_leave_days(start, end, LeaveRequest.DayPart.FULL)
        request = LeaveRequest.objects.create(
            employee=employee,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            day_part=LeaveRequest.DayPart.FULL,
            total_days=days,
            reason=reason,
            status=LeaveStatus.PENDING_MANAGER,
        )
        balance = get_or_create_balance(employee, leave_type, start.year)
        balance.pending_days += days
        balance.save(update_fields=["pending_days", "updated_at"])
        return request

    return _book


@pytest.fixture
def approve_leave(org):
    """Runs a leave request through **both** stages.

    Leave became two-stage in Phase 3 (manager, then HR, per decision D1).
    Tests elsewhere in the codebase only need "this leave is approved" as a
    precondition, so they say it once here rather than repeating both calls -
    and cannot accidentally assert against a half-approved request.
    """
    from apps.leave_management.services import hr_approve, manager_approve

    def _approve(request_pk: int, actor=None, comment: str = ""):
        manager_approve(request_pk, actor or org["manager"].user, comment)
        return hr_approve(request_pk, org["hr"].user, comment)

    return _approve


@pytest.fixture
def project(db, department) -> Project:
    return Project.objects.create(
        code="PRJ-001",
        name="Northwind Retail Platform",
        client_name="Northwind Traders",
        department=department,
        status=Project.Status.ACTIVE,
        start_date=date(2025, 1, 6),
    )


@pytest.fixture
def allocated_project(project, org) -> Project:
    """Project with the employee allocated to it, so timesheets are bookable."""
    ProjectMember.objects.create(
        project=project,
        employee=org["employee"],
        role_in_project=ProjectMember.ProjectRole.DEVELOPER,
        joined_on=project.start_date,
    )
    ProjectAllocation.objects.create(
        project=project,
        employee=org["employee"],
        allocation_percentage=Decimal("60"),
        start_date=project.start_date,
    )
    return project


@pytest.fixture
def next_monday() -> date:
    """A stable future Monday, so weekend rules are deterministic.

    Right for leave, which is applied for ahead of time. Timesheets want
    `past_monday`: hours report work already done, so a future day is refused.
    """
    today = date.today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


@pytest.fixture
def past_monday() -> date:
    """The Monday of the week before last - every day of it already happened.

    Timesheet rules reject a work date after today, so a fixture week has to be
    wholly behind us or the tests depend on which day they are run.
    """
    today = date.today()
    return today - timedelta(days=today.weekday() + 14)


# The end-to-end walkthroughs under tests/e2e are not pytest tests: each is a
# standalone script that configures Django against its own settings and exits
# with the number of failed checks. Their `e2e_*.py` names already fall outside
# `python_files`, but say it here too - and say it *here* rather than in a
# conftest of their own, which would shadow this module for every test that
# does `from conftest import ...`.
collect_ignore_glob = ["tests/e2e/*.py"]
