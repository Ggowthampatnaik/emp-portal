"""End-to-end: an employee's own use of the portal."""

from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

asha = Persona("asha.rao@trigyan.io", "Employee")

# ---------------------------------------------------------------------------
scenario("Employee: signing in and landing on the dashboard")
# ---------------------------------------------------------------------------
me = asha.get("/api/v1/auth/me/")
check("GET /auth/me works", me.status_code == 200, str(me.status_code))
identity = data(me)
check(
    "identity carries roles and permissions",
    bool(identity.get("roles")) and bool(identity.get("permissions")),
)
check(
    "the profile gate is open for an established employee",
    identity.get("profile_completed") is True,
    str(identity.get("profile_completed")),
)

dash = asha.get("/api/v1/dashboard/summary/")
check("dashboard summary loads", dash.status_code == 200, str(dash.status_code))
summary = data(dash)
check("dashboard shows the employee's own figures", "me" in summary, str(list(summary)))
check("dashboard carries upcoming birthdays", "upcoming_birthdays" in summary, str(list(summary)))
check("dashboard carries upcoming holidays", "upcoming_holidays" in summary, str(list(summary)))
if "approvals" in summary:
    check("an employee is not given an approvals card", False, "approvals present")
else:
    check("an employee is not given an approvals card", True)

# ---------------------------------------------------------------------------
scenario("Employee: their own profile")
# ---------------------------------------------------------------------------
profile = asha.get("/api/v1/employees/me/")
check("own record loads", profile.status_code == 200, str(profile.status_code))
mine = data(profile)
employee_id = mine.get("id")

edit = asha.client.patch(
    f"/api/v1/employees/{employee_id}/",
    '{"phone": "+91 90000 12345"}',
    content_type="application/json",
)
check("can edit own contact details", edit.status_code == 200, str(edit.status_code))
check("the edit stuck", data(edit).get("phone") == "+91 90000 12345")

forbidden = asha.client.patch(
    f"/api/v1/employees/{employee_id}/",
    '{"employee_code": "TRG9999"}',
    content_type="application/json",
)
check(
    "cannot edit employment fields on own record",
    forbidden.status_code == 403,
    str(forbidden.status_code),
)

# Bank details: their own, in full.
bank = asha.get(f"/api/v1/employees/{employee_id}/bank-account/")
check("own bank details load", bank.status_code == 200, str(bank.status_code))
check(
    "the owner sees the full account number", "account_number" in data(bank), str(list(data(bank)))
)

# Skills.
skills = asha.put(
    f"/api/v1/employees/{employee_id}/skills/",
    {"skills": [{"skill": 1, "proficiency": "advanced", "years_of_experience": "4.0"}]},
)
check("can record own skills", skills.status_code == 200, str(skills.status_code))

# Experience (Phase 7).
experience = asha.put(
    f"/api/v1/employees/{employee_id}/experience/",
    {
        "experience": [
            {
                "company_name": "Northwind",
                "job_title": "Engineer",
                "from_date": "2019-06-01",
                "to_date": "2021-02-14",
            }
        ]
    },
)
check("can record previous employment", experience.status_code == 200, str(experience.status_code))

# ---------------------------------------------------------------------------
scenario("Employee: applying for leave")
# ---------------------------------------------------------------------------
balances = asha.get("/api/v1/leave-balances/me/")
check("leave balances load", balances.status_code == 200, str(balances.status_code))
rows = data(balances)
check("balances are opened for every active leave type", len(rows) > 0, str(len(rows)))

types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next((t for t in types.get("results", []) if t["code"] == "EL"), None)
check("leave types are readable", earned is not None)

# A future Monday nobody has booked.
start = date.today() + timedelta(days=30)
while start.weekday() != 0:
    start += timedelta(days=1)

peer_id = None
directory = data(asha.get("/api/v1/employees/search/", q="kar"))
if directory:
    peer_id = directory[0]["user_id"]
check("the people picker finds colleagues", peer_id is not None, str(directory))

applied = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=1)).isoformat(),
        "reason": "End-to-end walkthrough: family function.",
        "cc_user_ids": [peer_id] if peer_id else [],
    },
)
check("leave request is accepted", applied.status_code == 201, str(data(applied)))
request = data(applied)
leave_id = request.get("id")
check(
    "it starts with the manager",
    request.get("status") == "pending_manager",
    str(request.get("status")),
)
check(
    "the CC recipient is recorded and notified",
    len(request.get("cc_recipients", [])) == 1
    and request["cc_recipients"][0]["notified_at"] is not None,
    str(request.get("cc_recipients")),
)

after = data(asha.get("/api/v1/leave-balances/me/"))
el = next((row for row in after if row["leave_type_code"] == "EL"), {})
check(
    "the days are reserved, not spent",
    float(el.get("pending_days", 0)) >= 2 and float(el.get("used_days", 0)) == 0,
    f"pending={el.get('pending_days')} used={el.get('used_days')}",
)

mine_list = data(asha.get("/api/v1/leaves/me/"))
check(
    "the request appears in my requests",
    any(r["id"] == leave_id for r in mine_list.get("results", mine_list)),
    str(type(mine_list)),
)

# ---------------------------------------------------------------------------
scenario("Employee: the weekly timesheet")
# ---------------------------------------------------------------------------
# A week nobody has booked: the seed already submitted the current one, and a
# submitted sheet is correctly read-only.
monday = date.today() - timedelta(days=date.today().weekday() + 7 * 6)
weekly = asha.get("/api/v1/timesheets/weekly/", date=monday.isoformat())
check(
    "the weekly grid loads (creating the sheet)", weekly.status_code == 200, str(weekly.status_code)
)
sheet = data(weekly)
sheet_id = sheet.get("id")

allocations = data(asha.get("/api/v1/my-allocations/"))
allocated = allocations.get("results", allocations)
check(
    "the employee has project allocations to book against", len(allocated) > 0, str(len(allocated))
)

if allocated:
    project = allocated[0]["project"]
    entries = [
        {
            "project": project,
            "work_date": (monday + timedelta(days=i)).isoformat(),
            "hours": "8.00",
            "description": "End-to-end walkthrough.",
        }
        for i in range(5)
    ]
    saved = asha.put(f"/api/v1/timesheets/{sheet_id}/entries/", {"entries": entries})
    check("the week saves", saved.status_code == 200, str(data(saved))[:120])
    check(
        "40 hours recorded",
        data(saved).get("total_hours") == "40.00",
        str(data(saved).get("total_hours")),
    )

    # The F5 rule: a description is required on every entry.
    blank = [dict(row, description="") for row in entries]
    asha.put(f"/api/v1/timesheets/{sheet_id}/entries/", {"entries": blank})
    refused = asha.post(f"/api/v1/timesheets/{sheet_id}/submit/", {})
    check(
        "submitting without descriptions is refused",
        refused.status_code == 409,
        str(refused.status_code),
    )

    asha.put(f"/api/v1/timesheets/{sheet_id}/entries/", {"entries": entries})
    submitted = asha.post(f"/api/v1/timesheets/{sheet_id}/submit/", {})
    check(
        "submitting with descriptions works",
        submitted.status_code == 200,
        str(data(submitted))[:120],
    )
    check(
        "the sheet locks once submitted",
        data(submitted).get("is_editable") is False,
        str(data(submitted).get("is_editable")),
    )

# ---------------------------------------------------------------------------
scenario("Employee: payslips")
# ---------------------------------------------------------------------------
periods = asha.get("/api/v1/payslips/periods/")
check("payslip periods load", periods.status_code == 200, str(periods.status_code))
years = data(periods).get("years", [])
check("there is at least one year of payslips", len(years) > 0, str(years))

if years:
    slip_id = years[0]["months"][0]["payslip_id"]
    detail = asha.get(f"/api/v1/payslips/{slip_id}/")
    check("the payslip breakdown loads", detail.status_code == 200, str(detail.status_code))

    pdf = asha.get(f"/api/v1/payslips/{slip_id}/pdf/")
    check("the PDF downloads", pdf.status_code == 200, str(pdf.status_code))
    check("it is really a PDF", pdf.content[:5] == b"%PDF-", str(pdf.content[:16]))
    check(
        "it is named EmployeeName_Year_Month.pdf",
        "AshaRao_" in pdf["Content-Disposition"],
        pdf["Content-Disposition"],
    )

# ---------------------------------------------------------------------------
scenario("Employee: what they must NOT be able to reach")
# ---------------------------------------------------------------------------
for label, response in [
    ("the full employee list beyond themselves", asha.get("/api/v1/employees/")),
    ("someone else's leave", asha.get("/api/v1/leaves/")),
]:
    rows = data(response).get("results", [])
    check(
        f"scoped: {label}",
        all(r.get("employee_code", "TRG0005") == "TRG0005" for r in rows),
        str(len(rows)),
    )

blocked = {
    "salary structures": asha.get("/api/v1/salary-structures/"),
    "payroll runs": asha.get("/api/v1/payroll-runs/"),
    "the admin user list": asha.get("/api/v1/admin/users/"),
    "the finance queue": asha.get("/api/v1/finance/approvals/"),
    "the account closure queue": asha.get("/api/v1/admin/deletion-requests/"),
    "employee reports": asha.get("/api/v1/reports/employees/"),
    "the leave approval queue": asha.get("/api/v1/leaves/pending-approvals/"),
    "the HR leave queue": asha.get("/api/v1/leaves/hr-approvals/"),
    "timesheet submission tracking": asha.get("/api/v1/timesheets/status/by-employee/"),
}
for label, response in blocked.items():
    check(f"refused: {label}", response.status_code == 403, str(response.status_code))

note(f"employee id = {employee_id}, leave request = {leave_id}")
raise SystemExit(summarise())
