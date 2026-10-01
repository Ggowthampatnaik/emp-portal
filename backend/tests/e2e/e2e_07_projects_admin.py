"""End-to-end: projects and staffing, the admin surfaces, the Super Admin, notifications."""

import json
from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

sneha = Persona("sneha.kulkarni@trigyan.io", "Super Admin")
rahul = Persona("rahul.iyer@trigyan.io", "Admin")
priya = Persona("priya.menon@trigyan.io", "HR")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
asha = Persona("asha.rao@trigyan.io", "Employee")

# ---------------------------------------------------------------------------
scenario("Projects: portfolio, team and allocations")
# ---------------------------------------------------------------------------
portfolio = data(rahul.get("/api/v1/projects/", page_size=50))
check("the portfolio loads", portfolio.get("count", 0) > 0, str(portfolio.get("count")))

created = rahul.post(
    "/api/v1/projects/",
    {
        "code": "PRJ-E2E",
        "name": "Walkthrough Platform",
        "client_name": "Northwind",
        "department": 1,
        "status": "active",
        "start_date": date.today().isoformat(),
        "is_billable": True,
    },
)
check("an administrator can open a project", created.status_code == 201, str(data(created))[:160])
project_id = data(created).get("id")

# Somebody with spare capacity: the demo data already books several people to
# 100%, and the allocation rule rightly refuses to go past that.
from apps.employees.models import Employee  # noqa: E402
from apps.projects.models import ProjectAllocation  # noqa: E402

spare = None
for candidate in Employee.objects.filter(employment_status="active"):
    booked = sum(
        a.allocation_percentage
        for a in ProjectAllocation.objects.filter(employee=candidate, is_active=True)
    )
    if booked <= 50:
        spare = candidate
        break
check("there is someone with capacity to allocate", spare is not None)
note(f"allocating {spare.employee_code if spare else '?'}, who has room")

if project_id and spare:
    detail = data(rahul.get(f"/api/v1/projects/{project_id}/"))
    check("the detail page loads", detail.get("code") == "PRJ-E2E", str(detail.get("code")))
    check(
        "it starts with nobody on it",
        detail.get("member_count") == 0,
        str(detail.get("member_count")),
    )

    member = vikram.post(
        f"/api/v1/projects/{project_id}/members/",
        {
            "employee": spare.pk,
            "role_in_project": "developer",
            "joined_on": date.today().isoformat(),
        },
    )
    check("a manager can assign someone", member.status_code == 201, str(data(member))[:160])

    allocated = vikram.post(
        f"/api/v1/projects/{project_id}/allocations/",
        {
            "employee": spare.pk,
            "allocation_percentage": "40.00",
            "start_date": date.today().isoformat(),
        },
    )
    check("and allocate their time", allocated.status_code == 201, str(data(allocated))[:160])

    over = vikram.post(
        f"/api/v1/projects/{project_id}/allocations/",
        {
            "employee": spare.pk,
            "allocation_percentage": "90.00",
            "start_date": date.today().isoformat(),
        },
    )
    check(
        "allocating someone past 100% is refused",
        over.status_code in (400, 409),
        str(over.status_code),
    )
    check(
        "and the message explains the overcommitment",
        "100" in str(data(over)) or "alloc" in str(data(over)).lower(),
        str(data(over))[:120],
    )

    team = data(rahul.get(f"/api/v1/projects/{project_id}/members/"))
    check("the team list shows them", any(m["employee"] == spare.pk for m in team), str(len(team)))

    check(
        "the allocation is recorded against the project",
        ProjectAllocation.objects.filter(project_id=project_id, employee=spare).exists(),
    )

    check(
        "an administrator opens projects but does not staff them (role split)",
        rahul.post(
            f"/api/v1/projects/{project_id}/members/",
            {"employee": 8, "role_in_project": "developer", "joined_on": date.today().isoformat()},
        ).status_code
        == 403,
    )

    check(
        "an employee cannot assign people to projects",
        asha.post(
            f"/api/v1/projects/{project_id}/members/",
            {"employee": 6, "role_in_project": "developer", "joined_on": date.today().isoformat()},
        ).status_code
        == 403,
    )

# ---------------------------------------------------------------------------
scenario("Departments and designations")
# ---------------------------------------------------------------------------
departments = data(priya.get("/api/v1/departments/"))
check("departments load", departments.get("count", 0) > 0, str(departments.get("count")))
check(
    "each carries a headcount",
    "employee_count" in (departments.get("results") or [{}])[0],
    str(list((departments.get("results") or [{}])[0])),
)

new_department = priya.post(
    "/api/v1/departments/", {"code": "E2E", "name": "Walkthrough Department"}
)
check("HR can add a department", new_department.status_code == 201, str(data(new_department))[:140])
duplicate = priya.post("/api/v1/departments/", {"code": "E2E", "name": "Again"})
check("a duplicate code is refused", duplicate.status_code == 400, str(duplicate.status_code))
check(
    "an employee cannot add one",
    asha.post("/api/v1/departments/", {"code": "X", "name": "No"}).status_code == 403,
)

designations = data(priya.get("/api/v1/designations/"))
check("designations load", designations.get("count", 0) > 0, str(designations.get("count")))

# ---------------------------------------------------------------------------
scenario("Manager scoping goes down the whole tree")
# ---------------------------------------------------------------------------
lead = Persona("meera.joshi@trigyan.io", "Team lead") if False else None
chart = data(rahul.get("/api/v1/employees/org-chart/"))
check("the org chart is a tree", isinstance(chart, list) and len(chart) > 0, str(type(chart)))

branch = data(vikram.get("/api/v1/employees/", page_size=50))
codes = {row["employee_code"] for row in branch.get("results", [])}
check("a manager sees their own branch", "TRG0005" in codes, str(sorted(codes)))
check("and not the whole company", len(codes) < 14, str(len(codes)))

# ---------------------------------------------------------------------------
scenario("Administration: users and roles")
# ---------------------------------------------------------------------------
users = data(rahul.get("/api/v1/admin/users/", search="asha"))
check("an administrator can find a user", users.get("count", 0) >= 1, str(users.get("count")))

if users.get("results"):
    user_id = users["results"][0]["id"]
    before = users["results"][0].get("roles", [])

    granted = rahul.post(
        f"/api/v1/admin/users/{user_id}/roles/", {"roles": ["employee", "manager"]}
    )
    check("roles can be granted", granted.status_code == 200, str(data(granted))[:140])
    check(
        "the change took",
        "manager" in data(granted).get("roles", []),
        str(data(granted).get("roles")),
    )

    restored = rahul.post(
        f"/api/v1/admin/users/{user_id}/roles/", {"roles": before or ["employee"]}
    )
    check(
        "and taken away again",
        "manager" not in data(restored).get("roles", []),
        str(data(restored).get("roles")),
    )

    reset = rahul.post(
        f"/api/v1/admin/users/{user_id}/reset-password/", {"temporary_password": "Reissued@2026"}
    )
    check(
        "an administrator can issue a temporary password",
        reset.status_code == 204,
        str(reset.status_code),
    )

    from django.test import Client

    signed = Client().post(
        "/api/v1/auth/login/",
        {"email": "asha.rao@trigyan.io", "password": "Reissued@2026"},
        content_type="application/json",
    )
    check("the employee can sign in with it", signed.status_code == 200, str(signed.status_code))
    check("and is forced to change it", data(signed)["user"]["must_change_password"] is True)
    check(
        "their earlier session was retired",
        asha.get("/api/v1/auth/me/").status_code == 401,
        str(asha.get("/api/v1/auth/me/").status_code),
    )

settings_rows = data(rahul.get("/api/v1/admin/settings/"))
if settings_rows.get("results"):
    key = settings_rows["results"][0]
    updated = rahul.client.patch(
        f"/api/v1/admin/settings/{key['id']}/",
        json.dumps({"value": key["value"]}),
        content_type="application/json",
    )
    check("a setting can be edited", updated.status_code == 200, str(updated.status_code))

check(
    "an administrator is not given payroll processing",
    rahul.post("/api/v1/payroll-runs/", {"year": 2020, "month": 1}).status_code == 403,
)

# ---------------------------------------------------------------------------
scenario("Super Admin reaches everything")
# ---------------------------------------------------------------------------
for label, path in {
    "the employee list": "/api/v1/employees/",
    "leave": "/api/v1/leaves/",
    "the HR leave queue": "/api/v1/leaves/hr-approvals/",
    "timesheet tracking": "/api/v1/timesheets/status/by-employee/",
    "payroll runs": "/api/v1/payroll-runs/",
    "salary structures": "/api/v1/salary-structures/",
    "the Finance queue": "/api/v1/finance/approvals/",
    "account closures": "/api/v1/admin/deletion-requests/",
    "users": "/api/v1/admin/users/",
    "the audit log": "/api/v1/admin/audit-logs/",
    "employee reports": "/api/v1/reports/employees/",
}.items():
    response = sneha.get(path)
    check(f"Super Admin can reach {label}", response.status_code == 200, str(response.status_code))

# ---------------------------------------------------------------------------
scenario("Notifications reach the right people")
# ---------------------------------------------------------------------------
from apps.notifications.models import Notification  # noqa: E402

karthik = Persona("karthik.reddy@trigyan.io", "Colleague")
types = data(karthik.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
start = date.today() + timedelta(days=200)
while start.weekday() != 0:
    start += timedelta(days=1)

before_manager = Notification.objects.filter(recipient=vikram.user).count()
applied = karthik.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "reason": "Walkthrough: notification check.",
        "cc_user_ids": [asha.user.pk],
    },
)
leave_id = data(applied).get("id")
check(
    "applying tells the manager",
    Notification.objects.filter(recipient=vikram.user).count() > before_manager,
)
check(
    "and the person copied in",
    Notification.objects.filter(recipient=asha.user, title__contains="Copied on").exists(),
)

before_hr = Notification.objects.filter(recipient=priya.user).count()
vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Fine."})
check(
    "the manager approving tells HR",
    Notification.objects.filter(recipient=priya.user).count() > before_hr,
)
check(
    "and tells the employee it moved on",
    Notification.objects.filter(recipient=karthik.user, title__contains="manager").exists(),
)

priya.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Confirmed."})
check(
    "HR approving tells the employee it is confirmed",
    Notification.objects.filter(recipient=karthik.user, level="success").exists(),
)

unread = data(karthik.get("/api/v1/notifications/unread-count/"))
check("the unread badge counts them", unread.get("unread", 0) > 0, str(unread))

listed = data(karthik.get("/api/v1/notifications/"))
if listed.get("results"):
    marked = karthik.post(f"/api/v1/notifications/{listed['results'][0]['id']}/read/", {})
    check("one can be marked read", marked.status_code in (200, 204), str(marked.status_code))
all_read = karthik.post("/api/v1/notifications/read-all/", {})
check("and all of them at once", all_read.status_code in (200, 204), str(all_read.status_code))
check(
    "the badge clears",
    data(karthik.get("/api/v1/notifications/unread-count/")).get("unread") == 0,
    str(data(karthik.get("/api/v1/notifications/unread-count/"))),
)

check(
    "nobody can read someone else's notifications",
    (
        all(
            n["id"] not in {x["id"] for x in listed.get("results", [])}
            for n in data(asha.get("/api/v1/notifications/")).get("results", [])
        )
        if listed.get("results")
        else True
    ),
)

raise SystemExit(summarise())
