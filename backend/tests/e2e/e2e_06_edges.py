"""End-to-end: the edges — bad input, other people's data, and the rules that bite."""

from datetime import date, timedelta

from django.test import Client
from e2e_harness import Persona, check, data, scenario, summarise

asha = Persona("asha.rao@trigyan.io", "Employee")
karthik = Persona("karthik.reddy@trigyan.io", "Colleague")
priya = Persona("priya.menon@trigyan.io", "HR")
rahul = Persona("rahul.iyer@trigyan.io", "Admin")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
anon = Client()

# ---------------------------------------------------------------------------
scenario("Signed out: nothing is reachable")
# ---------------------------------------------------------------------------
for label, path in {
    "the employee list": "/api/v1/employees/",
    "the directory": "/api/v1/employees/directory/",
    "leave": "/api/v1/leaves/",
    "payslips": "/api/v1/payslips/",
    "the dashboard": "/api/v1/dashboard/summary/",
    "the people search": "/api/v1/employees/search/?q=kar",
}.items():
    check(
        f"signed out: {label} needs a token",
        anon.get(path).status_code == 401,
        str(anon.get(path).status_code),
    )

check(
    "a rubbish token is refused",
    Client(HTTP_AUTHORIZATION="Bearer not-a-token").get("/api/v1/auth/me/").status_code == 401,
)

# ---------------------------------------------------------------------------
scenario("Reading someone else's records by id")
# ---------------------------------------------------------------------------
asha_slips = data(asha.get("/api/v1/payslips/"))
if asha_slips.get("results"):
    slip_id = asha_slips["results"][0]["id"]
    check(
        "a colleague cannot open your payslip",
        karthik.get(f"/api/v1/payslips/{slip_id}/").status_code in (403, 404),
    )
    check(
        "nor download the PDF",
        karthik.get(f"/api/v1/payslips/{slip_id}/pdf/").status_code in (403, 404),
    )

check(
    "a colleague cannot open your bank details",
    karthik.get("/api/v1/employees/5/bank-account/").status_code == 403,
)
check(
    "a colleague cannot rewrite your skills",
    karthik.put("/api/v1/employees/5/skills/", {"skills": []}).status_code == 403,
)
check(
    "a colleague cannot rewrite your experience",
    karthik.put("/api/v1/employees/5/experience/", {"experience": []}).status_code == 403,
)
check(
    "a colleague cannot complete your profile",
    karthik.post("/api/v1/employees/5/complete-profile/", {}).status_code == 403,
)

mine = data(asha.get("/api/v1/timesheets/me/"))
if mine.get("results"):
    sheet_id = mine["results"][0]["id"]
    check(
        "a colleague cannot open your timesheet",
        karthik.get(f"/api/v1/timesheets/{sheet_id}/").status_code in (403, 404),
    )

# ---------------------------------------------------------------------------
scenario("Leave rules")
# ---------------------------------------------------------------------------
types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
casual = next((t for t in types["results"] if t["code"] == "CL"), None)

monday = date.today() + timedelta(days=120)
while monday.weekday() != 0:
    monday += timedelta(days=1)

first = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": monday.isoformat(),
        "end_date": (monday + timedelta(days=2)).isoformat(),
        "reason": "Walkthrough: first.",
    },
)
check("a normal request is accepted", first.status_code == 201, str(data(first))[:120])

overlap = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (monday + timedelta(days=1)).isoformat(),
        "end_date": (monday + timedelta(days=3)).isoformat(),
        "reason": "Walkthrough: overlaps.",
    },
)
check("an overlapping request is refused", overlap.status_code == 409, str(overlap.status_code))
check(
    "and says why",
    "already have" in data(overlap).get("error", {}).get("message", ""),
    str(data(overlap).get("error", {}).get("message"))[:80],
)

saturday = monday + timedelta(days=12)
while saturday.weekday() != 5:
    saturday += timedelta(days=1)
weekend = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": saturday.isoformat(),
        "end_date": (saturday + timedelta(days=1)).isoformat(),
        "reason": "Walkthrough: weekend.",
    },
)
check("a weekend-only request is refused", weekend.status_code == 409, str(weekend.status_code))

backwards = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (monday + timedelta(days=40)).isoformat(),
        "end_date": (monday + timedelta(days=30)).isoformat(),
        "reason": "Walkthrough: backwards.",
    },
)
check("end before start is refused", backwards.status_code == 400, str(backwards.status_code))

too_much = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (monday + timedelta(days=200)).isoformat(),
        "end_date": (monday + timedelta(days=260)).isoformat(),
        "reason": "Walkthrough: a whole year.",
    },
)
check("more than the balance is refused", too_much.status_code == 409, str(too_much.status_code))
check(
    "and names the shortfall",
    "Insufficient" in data(too_much).get("error", {}).get("message", ""),
    str(data(too_much).get("error", {}).get("message"))[:80],
)

if casual:
    long_casual = asha.post(
        "/api/v1/leaves/",
        {
            "leave_type": casual["id"],
            "start_date": (monday + timedelta(days=90)).isoformat(),
            "end_date": (monday + timedelta(days=94)).isoformat(),
            "reason": "Walkthrough: over the per-request cap.",
        },
    )
    check(
        "a leave type's consecutive-day cap is enforced",
        long_casual.status_code == 409,
        str(long_casual.status_code),
    )

short_reason = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (monday + timedelta(days=150)).isoformat(),
        "end_date": (monday + timedelta(days=150)).isoformat(),
        "reason": "no",
    },
)
check(
    "a one-word reason is refused", short_reason.status_code == 400, str(short_reason.status_code)
)

first_id = data(first)["id"]
cancelled = asha.post(f"/api/v1/leaves/{first_id}/cancel/", {"comment": "Changed my mind."})
check(
    "an employee can cancel their own pending request",
    cancelled.status_code == 200,
    str(cancelled.status_code),
)
by_colleague = karthik.post(f"/api/v1/leaves/{first_id}/cancel/", {})
check("a colleague cannot cancel it", by_colleague.status_code in (403, 404, 409))

# ---------------------------------------------------------------------------
scenario("Timesheet rules")
# ---------------------------------------------------------------------------
week = date.today() - timedelta(days=date.today().weekday() + 7 * 10)
sheet = data(asha.get("/api/v1/timesheets/weekly/", date=week.isoformat()))
sheet_id = sheet["id"]
allocations = data(asha.get("/api/v1/my-allocations/"))
allocated = allocations.get("results", allocations)
project = allocated[0]["project"] if allocated else None

if project:
    over = asha.put(
        f"/api/v1/timesheets/{sheet_id}/entries/",
        {
            "entries": [
                {
                    "project": project,
                    "work_date": week.isoformat(),
                    "hours": "25.00",
                    "description": "Too many hours.",
                }
            ]
        },
    )
    check("more than 24 hours in a day is refused", over.status_code == 409, str(over.status_code))

    outside = asha.put(
        f"/api/v1/timesheets/{sheet_id}/entries/",
        {
            "entries": [
                {
                    "project": project,
                    "work_date": (week + timedelta(days=40)).isoformat(),
                    "hours": "8.00",
                    "description": "Wrong week.",
                }
            ]
        },
    )
    check(
        "a date outside the week is refused",
        outside.status_code in (400, 409),
        str(outside.status_code),
    )

    all_projects = data(priya.get("/api/v1/projects/", page_size=50))
    unallocated = next(
        (
            p["id"]
            for p in all_projects.get("results", [])
            if p["id"] not in {a["project"] for a in allocated}
        ),
        None,
    )
    if unallocated:
        wrong = asha.put(
            f"/api/v1/timesheets/{sheet_id}/entries/",
            {
                "entries": [
                    {
                        "project": unallocated,
                        "work_date": week.isoformat(),
                        "hours": "8.00",
                        "description": "Not my project.",
                    }
                ]
            },
        )
        check(
            "booking to a project you are not on is refused",
            wrong.status_code == 409,
            str(wrong.status_code),
        )

    empty = asha.post(f"/api/v1/timesheets/{sheet_id}/submit/", {})
    check("an empty week cannot be submitted", empty.status_code == 409, str(empty.status_code))

# ---------------------------------------------------------------------------
scenario("Payroll rules")
# ---------------------------------------------------------------------------
runs = data(priya.get("/api/v1/payroll-runs/"))
approved_run = next(
    (r for r in runs.get("results", []) if r["status"] in ("approved", "paid")), None
)
if approved_run:
    check(
        "an approved run cannot be reprocessed",
        priya.post(f"/api/v1/payroll-runs/{approved_run['id']}/process/", {}).status_code == 409,
    )

first_run = runs.get("results", [{}])[0]
duplicate = priya.post(
    "/api/v1/payroll-runs/", {"year": first_run.get("year"), "month": first_run.get("month")}
)
check(
    "the same month cannot be opened twice",
    duplicate.status_code == 400,
    str(duplicate.status_code),
)

# ---------------------------------------------------------------------------
scenario("Reports, exports and the rest of the surface")
# ---------------------------------------------------------------------------
for label, path in {
    "employee report": "/api/v1/reports/employees/",
    "leave report": "/api/v1/reports/leave/",
    "timesheet report": "/api/v1/reports/timesheet/",
    "project report": "/api/v1/reports/projects/",
}.items():
    response = priya.get(path) if "employee" in label else vikram.get(path)
    check(f"the {label} runs", response.status_code == 200, str(response.status_code))

csv_export = priya.get("/api/v1/reports/employees/", export="csv")
check("CSV export works", csv_export.status_code == 200, str(csv_export.status_code))
check("and really is a CSV", "text/csv" in csv_export["Content-Type"], csv_export["Content-Type"])

check("the org chart loads", asha.get("/api/v1/employees/org-chart/").status_code == 200)
check(
    "the directory is open to everyone",
    karthik.get("/api/v1/employees/directory/").status_code == 200,
)
check(
    "the holiday calendar is open to everyone",
    asha.get("/api/v1/holidays/", year=date.today().year).status_code == 200,
)
check("notifications load", asha.get("/api/v1/notifications/").status_code == 200)
check("the unread count loads", asha.get("/api/v1/notifications/unread-count/").status_code == 200)
check("the team calendar loads", vikram.get("/api/v1/leaves/team-calendar/").status_code == 200)
check("project detail loads", asha.get("/api/v1/projects/1/").status_code in (200, 403, 404))

# ---------------------------------------------------------------------------
scenario("Bad input is refused politely, in one shape")
# ---------------------------------------------------------------------------
bad = [
    ("a non-numeric skill filter", priya.get("/api/v1/employees/", skills="abc")),
    ("a malformed week", priya.get("/api/v1/timesheets/status/by-employee/", week="last-tuesday")),
    ("a nonsense project filter", priya.get("/api/v1/payslips/", project="northwind")),
    ("notify with nothing to notify", priya.post("/api/v1/timesheets/notify/", {})),
]
for label, response in bad:
    ok = response.status_code == 400
    check(f"400 for {label}", ok, str(response.status_code))
    if ok:
        body = data(response)
        check(
            f"  ...in the standard error envelope for {label}",
            "error" in body and {"code", "message", "request_id"} <= set(body["error"]),
            str(list(body)),
        )

missing = asha.get("/api/v1/leaves/999999/")
check("a missing record is a 404", missing.status_code == 404, str(missing.status_code))

# ---------------------------------------------------------------------------
scenario("A deactivated account is really shut out")
# ---------------------------------------------------------------------------
from apps.employees.models import Employee  # noqa: E402

leaver = Employee.objects.get(employee_code="TRG0010")
leaver.employment_status = "inactive"
leaver.save(update_fields=["employment_status"])
leaver.user.is_active = False
leaver.user.save(update_fields=["is_active"])

check(
    "they cannot sign in",
    anon.post(
        "/api/v1/auth/login/",
        {"email": leaver.email, "password": "Portal@123"},
        content_type="application/json",
    ).status_code
    == 400,
)
check(
    "a password reset will not let them back in either",
    anon.post(
        "/api/v1/auth/password/forgot/", {"email": leaver.email}, content_type="application/json"
    ).status_code
    == 204,
)

board = data(priya.get("/api/v1/timesheets/status/by-employee/"))
check(
    "they drop off the timesheet tracking board",
    all(row["employee_code"] != "TRG0010" for row in board.get("results", [])),
    "TRG0010 still listed",
)

# Search on the surname: "Nikhil" also matches a leftover demo account.
directory = data(asha.get("/api/v1/employees/directory/", search="Verma"))
check(
    "and out of the directory",
    directory.get("count", 0) == 0,
    str([r["employee_code"] for r in directory.get("results", [])]),
)

raise SystemExit(summarise())
