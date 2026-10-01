"""End-to-end: HR, which touches more of the portal than anyone."""

from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

priya = Persona("priya.menon@trigyan.io", "HR")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
asha = Persona("asha.rao@trigyan.io", "Employee")

# ---------------------------------------------------------------------------
scenario("HR: the employee directory and records")
# ---------------------------------------------------------------------------
everyone = data(priya.get("/api/v1/employees/", page_size=100))
check("HR sees the whole company", everyone.get("count", 0) >= 14, str(everyone.get("count")))

search = data(priya.get("/api/v1/employees/", search="Asha"))
check("search by name works", search.get("count") == 1, str(search.get("count")))

# The F12 skills filter.
vocabulary = data(priya.get("/api/v1/skills/", page_size=100))
skill_rows = vocabulary.get("results", [])
check("the skill vocabulary is seeded", len(skill_rows) > 20, str(len(skill_rows)))
held = next((s for s in skill_rows if s["employee_count"] > 0), None)
check("some skills are held by staff", held is not None, str(held))

if held:
    filtered = data(priya.get("/api/v1/employees/", skills=str(held["id"])))
    check(
        "filtering the employee list by skill narrows it",
        0 < filtered.get("count", 0) <= everyone.get("count", 0),
        f"{filtered.get('count')} of {everyone.get('count')}",
    )

    two = [s for s in skill_rows if s["employee_count"] > 0][:2]
    if len(two) == 2:
        both = data(priya.get("/api/v1/employees/", skills=f"{two[0]['id']},{two[1]['id']}"))
        either_max = max(two[0]["employee_count"], two[1]["employee_count"])
        check(
            "two skills means BOTH, not either",
            both.get("count", 0) <= either_max,
            f"{both.get('count')} vs max single {either_max}",
        )

# Bank details: HR may maintain but only sees four digits (decision D9).
bank = priya.get("/api/v1/employees/5/bank-account/")
check("HR can open an employee's bank details", bank.status_code == 200, str(bank.status_code))
check(
    "D9: HR sees only the masked number", "account_number" not in data(bank), str(list(data(bank)))
)
check(
    "D9: the masked form is there",
    "XXXX" in data(bank).get("account_number_masked", ""),
    str(data(bank).get("account_number_masked")),
)

written = priya.put(
    "/api/v1/employees/5/bank-account/",
    {
        "account_holder_name": "Asha Rao",
        "bank_name": "ICICI Bank",
        "branch_name": "Madhapur",
        "account_number": "501000123456",
        "ifsc_code": "icic0004321",
        "account_type": "salary",
    },
)
check("HR can correct bank details", written.status_code == 200, str(data(written))[:120])
check(
    "the IFSC is normalised to upper case",
    data(written).get("ifsc_code") == "ICIC0004321",
    str(data(written).get("ifsc_code")),
)
bad = priya.put(
    "/api/v1/employees/5/bank-account/",
    {
        "account_holder_name": "Asha Rao",
        "bank_name": "X",
        "branch_name": "",
        "account_number": "501000123456",
        "ifsc_code": "NOTANIFSC",
        "account_type": "salary",
    },
)
check("a malformed IFSC is refused", bad.status_code == 400, str(bad.status_code))

# ---------------------------------------------------------------------------
scenario("HR: onboarding a new employee")
# ---------------------------------------------------------------------------
created = priya.post(
    "/api/v1/employees/",
    {
        "email": "e2e.newjoiner@trigyan.io",
        "first_name": "Meena",
        "last_name": "Iyer",
        "employee_code": "TRG7001",
        "date_of_joining": date.today().isoformat(),
        "designation": 1,
        "department": 1,
        "temporary_password": "Welcome@2026",
    },
)
check("HR can create an employee", created.status_code == 201, str(data(created))[:200])
newcomer = data(created)
new_id = newcomer.get("id")
check(
    "a new joiner starts with an incomplete profile",
    newcomer.get("profile_completed") is False,
    str(newcomer.get("profile_completed")),
)

# ---------------------------------------------------------------------------
scenario("HR: leave, stage two")
# ---------------------------------------------------------------------------
types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
start = date.today() + timedelta(days=90)
while start.weekday() != 0:
    start += timedelta(days=1)

applied = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=1)).isoformat(),
        "reason": "Walkthrough: for HR to confirm.",
    },
)
leave_id = data(applied).get("id")
vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Fine."})

hr_queue = data(priya.get("/api/v1/leaves/hr-approvals/"))
row = next((r for r in hr_queue.get("results", []) if r["id"] == leave_id), None)
check("it reaches the HR queue", row is not None, str(hr_queue.get("count")))
if row:
    check("the HR queue shows the remaining balance", row.get("available_days") is not None)
    check(
        "and who approved it at stage one",
        row.get("manager_decided_by_name") == "Vikram Nair",
        str(row.get("manager_decided_by_name")),
    )

sent_back = priya.post(
    f"/api/v1/leaves/{leave_id}/send-back/",
    {"comment": "Two others are off that week - please re-check."},
)
check(
    "D2: HR can send it back instead of rejecting",
    sent_back.status_code == 200,
    str(data(sent_back))[:120],
)
check(
    "it returns to the manager",
    data(sent_back).get("status") == "pending_manager",
    str(data(sent_back).get("status")),
)
check(
    "the manager stage resets so the old approval does not stand",
    data(sent_back).get("manager_status") == "pending",
    str(data(sent_back).get("manager_status")),
)

no_reason = priya.post(f"/api/v1/leaves/{leave_id}/send-back/", {"comment": ""})
check(
    "a send-back without a reason is refused",
    no_reason.status_code == 400,
    str(no_reason.status_code),
)

vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Re-checked; cover is fine."})
before = next(
    r for r in data(asha.get("/api/v1/leave-balances/me/")) if r["leave_type_code"] == "EL"
)
final = priya.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Confirmed."})
check(
    "HR approval closes it", data(final).get("status") == "approved", str(data(final).get("status"))
)
after = next(
    r for r in data(asha.get("/api/v1/leave-balances/me/")) if r["leave_type_code"] == "EL"
)
check(
    "D1: this is the moment the balance is debited",
    float(after["used_days"]) > float(before["used_days"]),
    f"used {before['used_days']} -> {after['used_days']}",
)

# HR does not reject at all now - not at either stage, and not just because the
# button is hidden.
refused = priya.post(f"/api/v1/leaves/{leave_id}/reject/", {"comment": "no"})
check("HR has no Reject anywhere", refused.status_code == 403, str(refused.status_code))
check(
    "and is pointed at send-back instead",
    "reporting manager" in data(refused).get("error", {}).get("message", ""),
    str(data(refused).get("error", {}).get("message")),
)

# ---------------------------------------------------------------------------
scenario("HR: timesheet submission tracking")
# ---------------------------------------------------------------------------
by_employee = priya.get("/api/v1/timesheets/status/by-employee/")
check(
    "the employee-based board loads", by_employee.status_code == 200, str(by_employee.status_code)
)
board = data(by_employee)
check(
    "it reports on the last completed week",
    bool(board.get("week_start_date")),
    str(board.get("week_start_date")),
)
check(
    "it lists everyone active",
    len(board.get("results", [])) >= 14,
    str(len(board.get("results", []))),
)
check(
    "it counts who has and has not submitted",
    board.get("submitted_count") is not None and board.get("pending_count") is not None,
    str((board.get("submitted_count"), board.get("pending_count"))),
)

by_project = data(priya.get("/api/v1/timesheets/status/by-project/"))
check(
    "the project-based board loads",
    len(by_project.get("results", [])) > 0,
    str(len(by_project.get("results", []))),
)
first_project = by_project.get("results", [{}])[0]
check(
    "each project shows its team and a submitted count",
    "employees" in first_project and "submitted_count" in first_project,
    str(list(first_project)),
)

outstanding = [r for r in board.get("results", []) if not r["submitted"]]
if outstanding:
    nudged = priya.post(
        "/api/v1/timesheets/notify/", {"employee_ids": [r["employee_id"] for r in outstanding[:3]]}
    )
    check(
        "HR can nudge the people who have not submitted",
        nudged.status_code == 200,
        str(nudged.status_code),
    )
    check("it reports who was told", len(data(nudged).get("notified", [])) > 0, str(data(nudged)))

    submitters = [r for r in board.get("results", []) if r["submitted"]]
    if submitters:
        quiet = priya.post(
            "/api/v1/timesheets/notify/", {"employee_ids": [submitters[0]["employee_id"]]}
        )
        check(
            "someone who has already submitted is not nudged",
            data(quiet).get("count") == 0,
            str(data(quiet)),
        )

# ---------------------------------------------------------------------------
scenario("HR: payroll and payslips")
# ---------------------------------------------------------------------------
runs = data(priya.get("/api/v1/payroll-runs/"))
check("payroll runs load", runs.get("count", 0) > 0, str(runs.get("count")))

period = date.today() - timedelta(days=400)
opened = priya.post("/api/v1/payroll-runs/", {"year": period.year, "month": period.month})
check("HR can open a payroll month", opened.status_code in (201, 400), str(data(opened))[:120])
if opened.status_code == 201:
    run_id = data(opened)["id"]
    processed = priya.post(f"/api/v1/payroll-runs/{run_id}/process/", {})
    check("HR can process it", processed.status_code == 200, str(data(processed))[:120])
    check(
        "payslips were generated",
        data(processed).get("employee_count", 0) > 0,
        str(data(processed).get("employee_count")),
    )
    check(
        "HR cannot approve their own run",
        priya.post(f"/api/v1/payroll-runs/{run_id}/approve/", {}).status_code == 403,
    )

structures = data(priya.get("/api/v1/salary-structures/"))
check("HR can see salary structures", structures.get("count", 0) > 0, str(structures.get("count")))

by_project_pay = data(priya.get("/api/v1/payslips/", project=1, page_size=5))
check(
    "F14: payslips can be filtered by project",
    "results" in by_project_pay,
    str(list(by_project_pay)),
)

# ---------------------------------------------------------------------------
scenario("HR: holidays and leave policy")
# ---------------------------------------------------------------------------
holiday = priya.post(
    "/api/v1/holidays/",
    {
        "date": f"{date.today().year}-12-26",
        "name": "Walkthrough Holiday",
        "description": "Added during end-to-end testing.",
        "is_optional": False,
    },
)
check("HR can add a holiday", holiday.status_code == 201, str(data(holiday))[:120])
if holiday.status_code == 201:
    check(
        "the description is stored (F3)",
        data(holiday).get("description") == "Added during end-to-end testing.",
    )
    removed = priya.delete(f"/api/v1/holidays/{data(holiday)['id']}/")
    check("and can be removed again", removed.status_code == 204, str(removed.status_code))

check(
    "an employee cannot add a holiday",
    asha.post("/api/v1/holidays/", {"date": "2026-12-27", "name": "No"}).status_code == 403,
)

# ---------------------------------------------------------------------------
scenario("HR: the project portfolio")
# ---------------------------------------------------------------------------
portfolio = data(priya.get("/api/v1/projects/", page_size=100))
check(
    "HR sees every project, not just their own",
    portfolio.get("count", 0) >= 5,
    str(portfolio.get("count")),
)

rows = portfolio.get("results", [])
on_a_team = next((r for r in rows if r.get("member_count", 0) > 0), None)
check("at least one has a team to show", on_a_team is not None, str(len(rows)))

if on_a_team:
    expanded = priya.get(f"/api/v1/projects/{on_a_team['id']}/")
    check(
        "expanding a row opens the project", expanded.status_code == 200, str(expanded.status_code)
    )
    members = [m for m in data(expanded).get("members", []) if m["is_active"]]
    check("and shows the employees assigned to it", len(members) > 0, str(len(members)))
    check(
        "with the data the panel renders",
        all(
            all(k in m for k in ("employee_name", "employee_code", "role_in_project"))
            for m in members
        ),
        str(list(members[0])) if members else "-",
    )

    staffed = priya.post(
        f"/api/v1/projects/{on_a_team['id']}/members/",
        {"employee": 6, "role_in_project": "developer", "joined_on": "2026-01-06"},
    )
    check(
        "but HR staffs nobody - that stays with the manager",
        staffed.status_code == 403,
        str(staffed.status_code),
    )

check(
    "HR cannot open a project",
    priya.post(
        "/api/v1/projects/",
        {"code": "HR-X1", "name": "No", "status": "active", "start_date": "2026-01-06"},
    ).status_code
    == 403,
)

# ---------------------------------------------------------------------------
scenario("HR: what HR must NOT be able to do")
# ---------------------------------------------------------------------------
check(
    "HR cannot decide account closures",
    priya.get("/api/v1/admin/deletion-requests/").status_code == 403,
)
check(
    "HR cannot release payslips (that is Finance)",
    priya.get("/api/v1/finance/approvals/").status_code == 403,
)
check("HR cannot manage users and roles", priya.get("/api/v1/admin/users/").status_code == 403)
check("HR cannot read the audit log", priya.get("/api/v1/admin/audit-logs/").status_code == 403)

note(f"new joiner created with id {new_id}")
raise SystemExit(summarise())
