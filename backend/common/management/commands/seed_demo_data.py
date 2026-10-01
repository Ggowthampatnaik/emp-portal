"""Populates the portal with a small, coherent organization for local testing.

Creates departments, designations, an employee hierarchy, projects with teams
and allocations, leave policies and balances, leave requests in every workflow
state, timesheets for the last few weeks, and the resulting notifications.

Idempotent: re-running updates the fixture rather than duplicating it. Refuses
to run unless DEBUG is on, so it can never touch a deployed environment.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.administration.models import SystemSetting
from apps.authentication.models import Role
from apps.employees.models import Department, Designation, Employee
from apps.leave_management.models import Holiday, LeaveType
from apps.leave_management.services import (
    apply_for_leave,
    get_or_create_balance,
    hr_approve,
    hr_send_back,
    manager_approve,
    manager_reject,
)
from apps.projects.models import Project, ProjectAllocation, ProjectMember
from apps.timesheets.models import Timesheet, TimesheetEntry
from apps.timesheets.services import approve_timesheet, submit_timesheet, week_start
from common.enums import ApprovalStatus, EmploymentStatus, RoleSlug

User = get_user_model()

DEMO_PASSWORD = "Portal@123"
BLOOD_GROUPS = ["A+", "B+", "O+", "AB+", "A-", "O-", "B-", "AB-"]
DOMAIN = "@trigyan.io"

#: Recorded per person rather than inferred from a first name. The field feeds
#: statutory headcount reporting, and a portal guessing it from "Ananya" is
#: precisely the behaviour that makes the field worth filling in deliberately.
GENDERS = {
    "TRG0001": "female",
    "TRG0002": "female",
    "TRG0003": "male",
    "TRG0004": "male",
    "TRG0005": "female",
    "TRG0006": "male",
    "TRG0007": "female",
    "TRG0008": "male",
    "TRG0009": "female",
    "TRG0010": "male",
    "TRG0011": "female",
    "TRG0012": "male",
    "TRG0013": "female",
    "TRG0014": "male",
}

#: Avatar backgrounds, dark enough to carry white initials at any size.
AVATAR_COLOURS = [
    (31, 111, 139),
    (153, 93, 129),
    (66, 103, 178),
    (176, 106, 60),
    (58, 125, 96),
    (120, 94, 166),
    (166, 82, 82),
]


DEPARTMENTS = [
    ("ENG", "Engineering", "Product engineering and platform teams."),
    ("QA", "Quality Assurance", "Test engineering and release validation."),
    ("HR", "Human Resources", "People operations, hiring and policy."),
    ("FIN", "Finance", "Accounting, payroll and procurement."),
    ("SLS", "Sales", "Client acquisition and account management."),
]

DESIGNATIONS = [
    ("TRN", "Trainee Engineer", 1),
    ("SE", "Software Engineer", 2),
    ("SSE", "Senior Software Engineer", 3),
    ("TL", "Technical Lead", 4),
    ("EM", "Engineering Manager", 5),
    ("QAE", "QA Engineer", 2),
    ("QAL", "QA Lead", 4),
    ("HRE", "HR Executive", 2),
    ("HRM", "HR Manager", 5),
    ("FA", "Finance Analyst", 2),
    ("AM", "Account Manager", 3),
    ("DIR", "Director", 7),
]

# code, first, last, dept, designation, roles, manager_code, joined
PEOPLE = [
    ("TRG0001", "Sneha", "Kulkarni", "ENG", "DIR", (RoleSlug.SUPER_ADMIN,), None, date(2018, 4, 2)),
    (
        "TRG0002",
        "Priya",
        "Menon",
        "HR",
        "HRM",
        (RoleSlug.EMPLOYEE, RoleSlug.HR),
        "TRG0001",
        date(2019, 6, 17),
    ),
    (
        "TRG0003",
        "Rahul",
        "Iyer",
        "ENG",
        "EM",
        (RoleSlug.EMPLOYEE, RoleSlug.ADMIN),
        "TRG0001",
        date(2019, 1, 7),
    ),
    (
        "TRG0004",
        "Vikram",
        "Nair",
        "ENG",
        "EM",
        (RoleSlug.EMPLOYEE, RoleSlug.MANAGER),
        "TRG0001",
        date(2019, 9, 2),
    ),
    ("TRG0005", "Asha", "Rao", "ENG", "SSE", (RoleSlug.EMPLOYEE,), "TRG0004", date(2021, 2, 15)),
    (
        "TRG0006",
        "Karthik",
        "Reddy",
        "ENG",
        "SE",
        (RoleSlug.EMPLOYEE,),
        "TRG0004",
        date(2022, 7, 11),
    ),
    (
        "TRG0007",
        "Meera",
        "Joshi",
        "ENG",
        "TL",
        (RoleSlug.EMPLOYEE, RoleSlug.MANAGER),
        "TRG0003",
        date(2020, 3, 9),
    ),
    ("TRG0008", "Arjun", "Pillai", "ENG", "SE", (RoleSlug.EMPLOYEE,), "TRG0007", date(2023, 1, 16)),
    (
        "TRG0009",
        "Divya",
        "Sharma",
        "QA",
        "QAL",
        (RoleSlug.EMPLOYEE, RoleSlug.MANAGER),
        "TRG0003",
        date(2020, 11, 23),
    ),
    ("TRG0010", "Nikhil", "Verma", "QA", "QAE", (RoleSlug.EMPLOYEE,), "TRG0009", date(2022, 5, 30)),
    (
        "TRG0011",
        "Fatima",
        "Sheikh",
        "FIN",
        "FA",
        (RoleSlug.EMPLOYEE, RoleSlug.FINANCE),
        "TRG0002",
        date(2021, 8, 2),
    ),
    ("TRG0012", "Rohan", "Desai", "SLS", "AM", (RoleSlug.EMPLOYEE,), "TRG0001", date(2020, 10, 5)),
    ("TRG0013", "Ananya", "Gupta", "ENG", "TRN", (RoleSlug.EMPLOYEE,), "TRG0007", date(2024, 6, 3)),
    (
        "TRG0014",
        "Suresh",
        "Kumar",
        "ENG",
        "SSE",
        (RoleSlug.EMPLOYEE,),
        "TRG0004",
        date(2021, 4, 19),
    ),
]

PROJECTS = [
    (
        "PRJ-001",
        "Northwind Retail Platform",
        "Northwind Traders",
        "ENG",
        "TRG0004",
        "active",
        date(2025, 1, 6),
    ),
    (
        "PRJ-002",
        "Contoso Payments Integration",
        "Contoso Ltd",
        "ENG",
        "TRG0007",
        "active",
        date(2025, 3, 3),
    ),
    ("PRJ-003", "Internal Portal Revamp", "", "ENG", "TRG0003", "active", date(2025, 5, 12)),
    (
        "PRJ-004",
        "Fabrikam Data Migration",
        "Fabrikam Inc",
        "ENG",
        "TRG0004",
        "planned",
        date(2025, 9, 1),
    ),
    ("PRJ-005", "Regression Automation Suite", "", "QA", "TRG0009", "completed", date(2024, 8, 1)),
]

# project code -> [(employee code, project role, allocation %)]
TEAMS = {
    "PRJ-001": [("TRG0005", "lead", 60), ("TRG0006", "developer", 50), ("TRG0010", "qa", 40)],
    "PRJ-002": [
        ("TRG0007", "manager", 40),
        ("TRG0008", "developer", 70),
        ("TRG0014", "developer", 50),
    ],
    "PRJ-003": [("TRG0005", "developer", 40), ("TRG0013", "developer", 80), ("TRG0010", "qa", 30)],
    "PRJ-004": [("TRG0014", "lead", 30)],
    "PRJ-005": [("TRG0009", "lead", 20), ("TRG0010", "qa", 30)],
}

#: code, name, days, paid, max consecutive, half-day, carry, restricted to
LEAVE_TYPES = [
    ("EL", "Earned Leave", Decimal("18.0"), True, None, True, True, ""),
    ("SL", "Sick Leave", Decimal("12.0"), True, 5, True, False, ""),
    ("CL", "Casual Leave", Decimal("8.0"), True, 3, True, False, ""),
    ("LOP", "Loss of Pay", Decimal("0.0"), False, None, False, False, ""),
    ("MAT", "Maternity Leave", Decimal("182.0"), True, None, False, False, "female"),
]

SETTINGS = [
    ("leave.year_start_month", "1", "integer", "Month the leave year begins (1 = January)."),
    ("timesheet.week_hours", "40", "integer", "Standard weekly hours used in reports."),
    (
        "timesheet.submission_deadline_day",
        "2",
        "integer",
        "Day of the following week a timesheet is due.",
    ),
    ("portal.support_email", "support@trigyan.io", "string", "Shown to employees who need help."),
    ("leave.allow_backdated_days", "7", "integer", "How many days back leave may be applied for."),
]


class Command(BaseCommand):
    help = "Populate the database with a demo organization (development only)."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--reset-passwords",
            action="store_true",
            help=f"Reset every demo account to the shared demo password ({DEMO_PASSWORD}).",
        )

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        if not settings.DEBUG:
            raise CommandError("seed_demo_data only runs with DEBUG enabled.")

        roles = {role.slug: role for role in Role.objects.all()}
        if not roles:
            raise CommandError("No roles found. Run 'manage.py seed_rbac' first.")

        departments = self._departments()
        designations = self._designations()
        employees = self._employees(roles, departments, designations, options["reset_passwords"])
        self._department_heads(departments, employees)
        self._photos(employees)
        projects = self._projects(departments, employees)
        self._teams(projects, employees)
        leave_types = self._leave_types()
        self._holidays()
        self._balances(employees, leave_types)
        self._leave_requests(employees, leave_types)
        self._timesheets(employees, projects)
        self._salary_structures(employees)
        self._payslip_releases()
        self._bank_accounts(employees)
        self._assets(employees)
        self._documents(employees)
        self._skills(employees)
        self._settings()

        self.stdout.write(
            self.style.SUCCESS(
                "\nDemo organization ready.\n"
                f"  {len(employees)} employees, {len(projects)} projects, "
                f"{len(leave_types)} leave types.\n\n"
                "Sign in with any of these (password for all: "
                f"{DEMO_PASSWORD}):\n"
                "  sneha.kulkarni@trigyan.io   Super Admin\n"
                "  rahul.iyer@trigyan.io       Admin\n"
                "  priya.menon@trigyan.io      HR\n"
                "  vikram.nair@trigyan.io      Manager (4 reports)\n"
                "  asha.rao@trigyan.io         Employee\n"
            )
        )

    # -- organization ------------------------------------------------------
    def _departments(self) -> dict[str, Department]:
        result = {}
        for code, name, description in DEPARTMENTS:
            result[code], _ = Department.objects.update_or_create(
                code=code, defaults={"name": name, "description": description, "is_active": True}
            )
        self.stdout.write(f"Departments: {len(result)}")
        return result

    def _designations(self) -> dict[str, Designation]:
        result = {}
        for code, name, level in DESIGNATIONS:
            result[code], _ = Designation.objects.update_or_create(
                code=code, defaults={"name": name, "level": level, "is_active": True}
            )
        self.stdout.write(f"Designations: {len(result)}")
        return result

    def _employees(self, roles, departments, designations, reset_passwords) -> dict[str, Employee]:
        result: dict[str, Employee] = {}

        # First pass: accounts and employment records (managers wired afterwards,
        # so the order of PEOPLE does not have to be topological).
        for index, (code, first, last, dept, desig, role_slugs, _manager, joined) in enumerate(
            PEOPLE
        ):
            email = f"{first.lower()}.{last.lower()}{DOMAIN}"
            user, created = User.objects.get_or_create(
                email=email, defaults={"first_name": first, "last_name": last}
            )
            if created or reset_passwords:
                user.set_password(DEMO_PASSWORD)
                user.must_change_password = False
                user.save(update_fields=["password", "must_change_password"])

            wanted = {roles[slug] for slug in role_slugs if slug in roles}
            user.user_roles.exclude(role__in=wanted).delete()
            for role in wanted:
                user.user_roles.get_or_create(role=role)
            user._role_slugs_cache = None
            user._permission_cache = None

            employee, _ = Employee.objects.update_or_create(
                employee_code=code,
                defaults={
                    "user": user,
                    "department": departments.get(dept),
                    "designation": designations.get(desig),
                    "date_of_joining": joined,
                    "employment_status": EmploymentStatus.ACTIVE,
                    "phone": f"+91 98{code[-4:]} {code[-4:]}",
                    "work_location": "Hyderabad",
                    "blood_group": BLOOD_GROUPS[int(code[-2:]) % len(BLOOD_GROUPS)],
                    "gender": GENDERS.get(code, ""),
                    "date_of_birth": self._birthday(index),
                    "permanent_address": f"{int(code[-3:])} MG Road, Hyderabad 500081",
                    "emergency_contact_name": "Family contact",
                    "emergency_contact_phone": "+91 90000 00000",
                },
            )
            result[code] = employee

        # Second pass: reporting lines.
        for code, *_rest in PEOPLE:
            manager_code = next(row[6] for row in PEOPLE if row[0] == code)
            employee = result[code]
            manager = result.get(manager_code) if manager_code else None
            if employee.reporting_manager_id != (manager.pk if manager else None):
                employee.reporting_manager = manager
                employee.save(update_fields=["reporting_manager", "updated_at"])

        self.stdout.write(f"Employees: {len(result)}")
        return result

    @staticmethod
    def _birthday(index: int) -> date:
        """Spread birthdays across the year, with the first few coming up soon.

        Anchored to today so the dashboard's "upcoming birthdays" card always
        has something in it, whenever the demo data is seeded.
        """
        soon = [3, 9, 17, 26]
        today = date.today()
        if index < len(soon):
            when = today + timedelta(days=soon[index])
        else:
            when = today + timedelta(days=45 + (index * 23) % 300)
        birth_year = 1985 + (index % 15)
        try:
            return when.replace(year=birth_year)
        except ValueError:  # 29 February in a common birth year
            return when.replace(year=birth_year, day=28)

    def _department_heads(self, departments, employees) -> None:
        heads = {
            "ENG": "TRG0003",
            "QA": "TRG0009",
            "HR": "TRG0002",
            "FIN": "TRG0011",
            "SLS": "TRG0012",
        }
        for dept_code, employee_code in heads.items():
            department = departments.get(dept_code)
            head = employees.get(employee_code)
            if department and head and department.head_id != head.pk:
                department.head = head
                department.save(update_fields=["head", "updated_at"])

    def _projects(self, departments, employees) -> dict[str, Project]:
        result = {}
        for code, name, client, dept, manager_code, status, start in PROJECTS:
            result[code], _ = Project.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "client_name": client,
                    "department": departments.get(dept),
                    "project_manager": employees.get(manager_code),
                    "status": status,
                    "start_date": start,
                    "end_date": date(2025, 7, 31) if status == "completed" else None,
                    "is_billable": bool(client),
                    "description": f"{name} - seeded demo project.",
                },
            )
        self.stdout.write(f"Projects: {len(result)}")
        return result

    def _teams(self, projects, employees) -> None:
        members = allocations = 0
        for project_code, rows in TEAMS.items():
            project = projects[project_code]
            for employee_code, project_role, percentage in rows:
                employee = employees[employee_code]
                _, created = ProjectMember.objects.get_or_create(
                    project=project,
                    employee=employee,
                    left_on=None,
                    defaults={
                        "role_in_project": project_role,
                        "joined_on": max(project.start_date, employee.date_of_joining),
                    },
                )
                members += int(created)

                _, created = ProjectAllocation.objects.update_or_create(
                    project=project,
                    employee=employee,
                    defaults={
                        "allocation_percentage": Decimal(percentage),
                        "start_date": max(project.start_date, employee.date_of_joining),
                        "is_active": project.status in {"active", "planned"},
                    },
                )
                allocations += int(created)
        self.stdout.write(f"Project members: {members} new, allocations: {allocations} new")

    # -- leave -------------------------------------------------------------
    def _leave_types(self) -> dict[str, LeaveType]:
        result = {}
        for code, name, days, is_paid, max_days, half_day, carry, gender in LEAVE_TYPES:
            result[code], _ = LeaveType.objects.update_or_create(
                code=code,
                defaults={
                    "name": name,
                    "days_per_year": days,
                    "is_paid": is_paid,
                    "requires_approval": True,
                    "max_consecutive_days": max_days,
                    "allow_half_day": half_day,
                    "carry_forward": carry,
                    "restricted_to_gender": gender,
                    "is_active": True,
                    "description": f"{name} policy.",
                },
            )
        self.stdout.write(f"Leave types: {len(result)}")
        return result

    def _holidays(self) -> None:
        """This year and next: the Holidays page has a year picker, and an
        empty next year reads as an oversight rather than a design.

        Two tables, because Indian holidays come in two kinds. The fixed-date
        ones repeat on the same day every year and can simply be shifted. The
        festival dates are lunar and move, so they are listed per year and
        cannot be derived - which is also why they must be checked against the
        company's published calendar before anyone relies on them.

        Descriptions throughout, because the portal itself refuses a holiday
        without one.
        """
        this_year = date.today().year
        fixed = [
            (1, 1, "New Year's Day", False, "Offices closed for the new year."),
            (1, 14, "Makar Sankranti / Pongal", False, "Harvest festival; offices closed."),
            (1, 26, "Republic Day", False, "National holiday for Republic Day."),
            (5, 1, "Labour Day", True, "Optional holiday for International Workers' Day."),
            (8, 15, "Independence Day", False, "National holiday for Independence Day."),
            (
                10,
                2,
                "Gandhi Jayanti",
                False,
                "National holiday marking the birth of Mahatma Gandhi.",
            ),
            (12, 25, "Christmas Day", False, "Offices closed for Christmas."),
        ]

        #: VERIFY BEFORE USE. Lunar festival dates move year to year and these
        #: are seed data for a demo, not an authority. Replace this table with
        #: the company's published holiday list; nothing else needs to change.
        movable = {
            2026: [
                (3, 4, "Holi", False, "Festival of colours; offices closed."),
                (3, 19, "Ugadi", False, "Telugu new year; offices closed."),
                (4, 3, "Good Friday", True, "Optional holiday."),
                (5, 27, "Bakrid / Eid al-Adha", True, "Optional holiday."),
                (9, 14, "Ganesh Chaturthi", False, "Offices closed for Ganesh Chaturthi."),
                (10, 20, "Dussehra", False, "Vijayadashami; offices closed."),
                (11, 8, "Diwali", False, "Festival of lights; offices closed."),
            ],
            2027: [
                (3, 22, "Holi", False, "Festival of colours; offices closed."),
                (4, 8, "Ugadi", False, "Telugu new year; offices closed."),
                (3, 26, "Good Friday", True, "Optional holiday."),
                (5, 17, "Bakrid / Eid al-Adha", True, "Optional holiday."),
                (9, 3, "Ganesh Chaturthi", False, "Offices closed for Ganesh Chaturthi."),
                (10, 9, "Dussehra", False, "Vijayadashami; offices closed."),
                (10, 29, "Diwali", False, "Festival of lights; offices closed."),
            ],
        }

        count = 0
        for year in (this_year, this_year + 1):
            entries = [(year, *row) for row in fixed]
            entries += [(year, *row) for row in movable.get(year, [])]
            for entry_year, month, day, name, optional, description in entries:
                Holiday.objects.update_or_create(
                    date=date(entry_year, month, day),
                    defaults={
                        "name": name,
                        "is_optional": optional,
                        "description": description,
                    },
                )
                count += 1

        if not movable.get(this_year + 1):
            self.stdout.write(
                self.style.WARNING(
                    f"  no festival dates listed for {this_year + 1} - add them to `movable`"
                )
            )
        self.stdout.write(f"Holidays: {count}")

    def _balances(self, employees, leave_types) -> None:
        year = date.today().year
        count = 0
        for employee in employees.values():
            for leave_type in leave_types.values():
                if not leave_type.available_to(employee):
                    continue  # maternity leave does not exist for the excluded
                get_or_create_balance(employee, leave_type, year)
                count += 1
        self.stdout.write(f"Leave balances: {count}")

    def _leave_requests(self, employees, leave_types) -> None:
        """One request in each state, so every queue and filter has content."""
        from apps.leave_management.models import LeaveRequest

        if LeaveRequest.objects.exists():
            self.stdout.write("Leave requests: already seeded, skipping")
            return

        today = date.today()
        manager = employees["TRG0004"].user
        lead = employees["TRG0007"].user
        hr = employees["TRG0002"].user
        created = 0

        # One request in every state of the two-stage workflow, so the manager
        # queue, the HR queue and the sent-back case all have something in them.
        plan = [
            # employee, type, start offset, days, reason, outcome
            ("TRG0005", "EL", 14, 3, "Family function out of town.", "pending_manager"),
            ("TRG0006", "SL", -7, 2, "Viral fever, doctor advised rest.", "approved"),
            ("TRG0008", "CL", 21, 1, "Personal errand.", "pending_hr"),
            ("TRG0013", "EL", -21, 5, "Vacation with family.", "approved"),
            ("TRG0010", "CL", 5, 2, "House shifting.", "rejected"),
            ("TRG0014", "EL", 30, 4, "Wedding in the family.", "sent_back"),
        ]

        for employee_code, type_code, offset, days, reason, outcome in plan:
            employee = employees[employee_code]
            start = self._next_weekday(today + timedelta(days=offset))
            end = self._add_working_days(start, days - 1)
            try:
                request = apply_for_leave(
                    employee=employee,
                    leave_type=leave_types[type_code],
                    start=start,
                    end=end,
                    reason=reason,
                )
            except Exception as exc:  # a seeded clash is not worth failing over
                self.stdout.write(self.style.WARNING(f"  skipped {employee_code}: {exc}"))
                continue

            actor = lead if employee.reporting_manager_id == employees["TRG0007"].pk else manager
            if outcome in {"approved", "pending_hr", "sent_back"}:
                manager_approve(request.pk, actor, "Fine by me.")
            if outcome == "approved":
                hr_approve(request.pk, hr, "Approved. Enjoy your time off.")
            elif outcome == "sent_back":
                hr_send_back(
                    request.pk, hr, "Two people are already off that week - please re-check."
                )
            elif outcome == "rejected":
                manager_reject(request.pk, actor, "Release week - please pick different dates.")
            created += 1

        self.stdout.write(f"Leave requests: {created}")

    @staticmethod
    def _next_weekday(day: date) -> date:
        while day.weekday() >= 5:
            day += timedelta(days=1)
        return day

    @staticmethod
    def _add_working_days(start: date, days: int) -> date:
        current = start
        added = 0
        while added < days:
            current += timedelta(days=1)
            if current.weekday() < 5:
                added += 1
        return current

    # -- timesheets --------------------------------------------------------
    def _timesheets(self, employees, projects) -> None:
        if Timesheet.objects.exists():
            self.stdout.write("Timesheets: already seeded, skipping")
            return

        this_monday = week_start(date.today())
        created = 0

        # (employee, weeks ago, outcome)
        plan = [
            ("TRG0005", 2, "approved"),
            ("TRG0005", 1, "pending"),
            ("TRG0005", 0, "draft"),
            ("TRG0006", 2, "approved"),
            ("TRG0006", 1, "pending"),
            ("TRG0008", 1, "pending"),
            ("TRG0013", 1, "approved"),
            ("TRG0014", 1, "pending"),
            ("TRG0010", 1, "draft"),
        ]

        for employee_code, weeks_ago, outcome in plan:
            employee = employees[employee_code]
            monday = this_monday - timedelta(weeks=weeks_ago)

            allocations = list(
                ProjectAllocation.objects.filter(employee=employee, is_active=True).select_related(
                    "project"
                )
            )
            if not allocations:
                continue

            timesheet, _ = Timesheet.objects.get_or_create(
                employee=employee, week_start_date=monday, defaults={"status": ApprovalStatus.DRAFT}
            )
            if timesheet.entries.exists():
                continue

            entries = []
            for day_offset in range(5):  # Mon-Fri
                work_date = monday + timedelta(days=day_offset)
                if work_date > date.today():
                    continue
                remaining = Decimal("8")
                for index, allocation in enumerate(allocations):
                    if remaining <= 0:
                        break
                    share = (
                        remaining
                        if index == len(allocations) - 1
                        else (
                            Decimal("8") * allocation.allocation_percentage / Decimal("100")
                        ).quantize(Decimal("0.5"))
                    )
                    share = min(share, remaining)
                    if share <= 0:
                        continue
                    entries.append(
                        TimesheetEntry(
                            timesheet=timesheet,
                            project=allocation.project,
                            work_date=work_date,
                            hours=share,
                            description=f"Work on {allocation.project.code}",
                            is_billable=allocation.project.is_billable,
                        )
                    )
                    remaining -= share

            TimesheetEntry.objects.bulk_create(entries)
            timesheet.recalculate_total()

            if outcome in {"pending", "approved"} and timesheet.total_hours > 0:
                submit_timesheet(timesheet.pk, employee.user, "Week complete.")
                if outcome == "approved":
                    approver = (
                        employee.reporting_manager.user if employee.reporting_manager else None
                    )
                    if approver:
                        approve_timesheet(timesheet.pk, approver, "Looks good.")
            created += 1

        self.stdout.write(f"Timesheets: {created}")

    def _salary_structures(self, employees) -> None:
        """A salary for every demo employee, scaled by designation level."""
        from apps.payroll.models import SalaryStructure

        created = 0
        for code, employee in employees.items():
            level = employee.designation.level if employee.designation_id else 2
            # Level alone gave everyone at a grade the identical figure, so two
            # managers appeared in the Finance queue at exactly the same net pay
            # - which reads as placeholder data rather than a payroll. The
            # spread is derived from the employee code, so it is stable across
            # re-seeds rather than random.
            spread = Decimal(sum(ord(char) for char in code) % 17) * Decimal("350")
            monthly = Decimal(28000 + level * 11000) + spread

            _, made = SalaryStructure.objects.update_or_create(
                employee=employee,
                effective_from=employee.date_of_joining,
                defaults={
                    "basic": (monthly * Decimal("0.50")).quantize(Decimal("1")),
                    "hra": (monthly * Decimal("0.25")).quantize(Decimal("1")),
                    "conveyance_allowance": Decimal("1600"),
                    "medical_allowance": Decimal("1250"),
                    "special_allowance": (monthly * Decimal("0.25") - Decimal("2850")).quantize(
                        Decimal("1")
                    ),
                    "provident_fund": (monthly * Decimal("0.06")).quantize(Decimal("1")),
                    "professional_tax": Decimal("200"),
                    "income_tax": (monthly * Decimal("0.08")).quantize(Decimal("1")),
                    "notes": f"Seeded structure for {code}.",
                },
            )
            created += int(made)
        self.stdout.write(f"Salary structures: {created} new")

    def _payslip_releases(self) -> None:
        """Put a few payslips in front of Finance, so its queue is not empty.

        One released, the rest waiting: enough to show both states without
        deciding everything for whoever is looking at the demo.
        """
        from apps.finance.models import PayslipApproval
        from apps.finance.services import process_payslip, release_payslip
        from apps.payroll.models import PayrollRun, Payslip

        if PayslipApproval.objects.exists():
            self.stdout.write("Payslip releases: already seeded, skipping")
            return

        hr = User.objects.filter(user_roles__role__slug=RoleSlug.HR).first()
        finance = User.objects.filter(user_roles__role__slug=RoleSlug.FINANCE).first()
        if hr is None or finance is None:
            self.stdout.write("Payslip releases: no HR or Finance account, skipping")
            return

        slips = list(
            Payslip.objects.filter(
                run__status__in=[PayrollRun.Status.APPROVED, PayrollRun.Status.PAID]
            ).order_by("employee__employee_code")[:4]
        )
        for index, slip in enumerate(slips):
            process_payslip(slip.pk, hr)
            if index == 0:
                release_payslip(slip.finance_approval.pk, finance, "Checked against the bank file.")

        self.stdout.write(f"Payslip releases: {len(slips)} sent to Finance")

    def _bank_accounts(self, employees) -> None:
        """A payable account for everyone, so the payroll bank sheet has rows."""
        from apps.employees.models import BankAccount

        banks = [
            ("HDFC Bank", "HDFC0001234", "Hitech City, Hyderabad"),
            ("ICICI Bank", "ICIC0004321", "Madhapur, Hyderabad"),
            ("State Bank of India", "SBIN0009876", "Gachibowli, Hyderabad"),
            ("Axis Bank", "UTIB0002468", "Kondapur, Hyderabad"),
        ]

        created = 0
        for index, (code, employee) in enumerate(sorted(employees.items())):
            bank_name, ifsc, branch = banks[index % len(banks)]
            _, made = BankAccount.objects.get_or_create(
                employee=employee,
                defaults={
                    "account_holder_name": employee.full_name,
                    "bank_name": bank_name,
                    "branch_name": branch,
                    # Demo-only digits; never a real account shape.
                    "account_number": f"5010{index:04d}{code[-4:]}",
                    "ifsc_code": ifsc,
                    "account_type": BankAccount.AccountType.SALARY,
                },
            )
            created += int(made)
        self.stdout.write(f"Bank accounts: {created} new")

    def _photos(self, employees) -> None:
        """Initials avatars, so the directory is not fourteen grey silhouettes.

        Drawn here rather than shipped as image files: a folder of stock
        headshots of people who do not exist is a worse thing to demo than
        initials, and the directory, org chart and dashboard all read as
        finished with something in them. Anyone who has uploaded a real photo
        keeps it - this only fills the gaps.
        """
        from io import BytesIO

        from django.core.files.base import ContentFile
        from PIL import Image, ImageDraw

        size = 256
        font = self._avatar_font(size // 2)
        made = 0
        for index, (code, employee) in enumerate(sorted(employees.items())):
            if employee.photo:
                continue
            initials = (employee.user.first_name[:1] + employee.user.last_name[:1]).upper()
            image = Image.new("RGB", (size, size), AVATAR_COLOURS[index % len(AVATAR_COLOURS)])
            draw = ImageDraw.Draw(image)
            left, top, right, bottom = draw.textbbox((0, 0), initials, font=font)
            draw.text(
                ((size - right - left) / 2, (size - bottom - top) / 2),
                initials,
                font=font,
                fill=(255, 255, 255),
            )
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            employee.photo.save(f"{code}.png", ContentFile(buffer.getvalue()), save=True)
            made += 1
        self.stdout.write(f"Photos: {made} new")

    @staticmethod
    def _avatar_font(size: int):
        """A font big enough for initials, wherever the seeder happens to run.

        Pillow's built-in default is a small bitmap face; asking it for a size
        needs a recent Pillow, so a real bold face is tried first.
        """
        from PIL import ImageFont

        candidates = (
            "C:/Windows/Fonts/segoeuib.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        )
        for candidate in candidates:
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
        return ImageFont.load_default(size=size)

    def _assets(self, employees) -> None:
        """Company kit, so the asset register is not an empty table in a demo.

        Two thirds of the staff, not all of them: "who has not been issued a
        machine yet" is half of what an asset register is for, and a table
        where every row is filled tells you nothing.
        """
        from apps.employees.models import EmployeeAsset

        kit = [
            ("MacBook Pro 14", "Apple"),
            ("ThinkPad X1 Carbon", "Lenovo"),
            ("Latitude 5440", "Dell"),
            ("Dell U2723 Monitor", "Dell"),
            ("iPhone 14", "Apple"),
            ("Galaxy A54", "Samsung"),
        ]

        created = 0
        for index, (code, employee) in enumerate(sorted(employees.items())):
            if index % 3 == 2:
                continue  # every third person is yet to be issued anything
            name, brand = kit[index % len(kit)]
            _, made = EmployeeAsset.objects.get_or_create(
                serial_number=f"TRG-{code[-4:]}-{index:02d}",
                defaults={
                    "employee": employee,
                    "name": name,
                    "brand": brand,
                },
            )
            created += int(made)
        self.stdout.write(f"Assets: {created} new")

    def _documents(self, employees) -> None:
        """A certificate or two per person.

        Real PDFs - the upload endpoint checks the first five bytes - so the
        rows in the profile are downloadable rather than dead links.
        """
        from django.core.files.base import ContentFile

        from apps.employees.models import EmployeeDocument

        papers = [
            ("tenth", "10th certificate"),
            ("bachelors", "Bachelor's certificate"),
            ("skill_certificate", "AWS Cloud Practitioner"),
        ]

        created = 0
        for index, (_code, employee) in enumerate(sorted(employees.items())):
            for offset in range(1 + index % 2):  # one or two each
                kind, title = papers[(index + offset) % len(papers)]
                if EmployeeDocument.objects.filter(employee=employee, document_type=kind).exists():
                    continue
                body = (
                    f"%PDF-1.4\n% Demo document for {employee.full_name}\n" f"% {title}\n%%EOF\n"
                ).encode()
                document = EmployeeDocument(
                    employee=employee,
                    document_type=kind,
                    title=title,
                    file_size=len(body),
                    content_type="application/pdf",
                )
                document.file.save(
                    f"{employee.employee_code}-{kind}.pdf", ContentFile(body), save=True
                )
                created += 1
        self.stdout.write(f"Documents: {created} new")

    def _skills(self, employees) -> None:
        """Spread the seeded vocabulary over the demo staff.

        Deterministic by employee code, so the skill filter has stable results
        to demonstrate rather than a different answer on every reseed.
        """
        from apps.employees.models import EmployeeSkill, Skill

        vocabulary = list(Skill.objects.filter(is_active=True).order_by("name"))
        if not vocabulary:
            self.stdout.write("Skills: vocabulary empty - run 'manage.py seed_skills' first")
            return

        proficiencies = list(EmployeeSkill.Proficiency.values)
        rows = []
        for index, (_, employee) in enumerate(sorted(employees.items())):
            if employee.skills.exists():
                continue
            for offset in range(4):
                skill = vocabulary[(index * 3 + offset * 7) % len(vocabulary)]
                if any(row.skill_id == skill.pk for row in rows if row.employee_id == employee.pk):
                    continue
                rows.append(
                    EmployeeSkill(
                        employee=employee,
                        skill=skill,
                        proficiency=proficiencies[(index + offset) % len(proficiencies)],
                        years_of_experience=Decimal(1 + (index + offset) % 8),
                    )
                )
        EmployeeSkill.objects.bulk_create(rows)
        self.stdout.write(f"Employee skills: {len(rows)} new")

    def _settings(self) -> None:
        for key, value, value_type, description in SETTINGS:
            SystemSetting.objects.update_or_create(
                key=key,
                defaults={"value": value, "value_type": value_type, "description": description},
            )
        self.stdout.write(f"System settings: {len(SETTINGS)}")
