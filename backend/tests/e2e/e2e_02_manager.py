"""End-to-end: a reporting manager's day."""

from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

vikram = Persona("vikram.nair@trigyan.io", "Manager")
asha = Persona("asha.rao@trigyan.io", "Employee")
outsider = Persona("rohan.desai@trigyan.io", "Unrelated employee")

# ---------------------------------------------------------------------------
scenario("Manager: dashboard and team")
# ---------------------------------------------------------------------------
summary = data(vikram.get("/api/v1/dashboard/summary/"))
check("the manager gets an approvals card", "approvals" in summary, str(list(summary)))
check(
    "it counts what is waiting on them",
    "pending_leave" in summary.get("approvals", {}),
    str(summary.get("approvals")),
)

team = data(vikram.get("/api/v1/employees/my-team/"))
check("direct reports load", isinstance(team, list) and len(team) > 0, str(type(team)))

visible = data(vikram.get("/api/v1/employees/"))
codes = {row["employee_code"] for row in visible.get("results", [])}
check(
    "the manager sees their branch and not the whole company",
    "TRG0005" in codes and "TRG0012" not in codes,
    str(sorted(codes)),
)

# ---------------------------------------------------------------------------
scenario("Manager: leave approval (stage one)")
# ---------------------------------------------------------------------------
# The employee applies for something new.
types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
start = date.today() + timedelta(days=45)
while start.weekday() != 0:
    start += timedelta(days=1)

applied = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "reason": "Walkthrough: one day off.",
    },
)
leave_id = data(applied).get("id")
check("the employee's request was created", applied.status_code == 201, str(data(applied)))

queue = data(vikram.get("/api/v1/leaves/pending-approvals/"))
in_queue = [row for row in queue.get("results", []) if row["id"] == leave_id]
check("it lands in the manager's queue", len(in_queue) == 1, str(queue.get("count")))
if in_queue:
    row = in_queue[0]
    check(
        "the queue shows the applicant's remaining balance",
        row.get("available_days") is not None,
        str(row.get("available_days")),
    )
    check(
        "the queue shows what stage it is at", row.get("stage") == "manager", str(row.get("stage"))
    )

check(
    "a manager cannot open the HR queue",
    vikram.get("/api/v1/leaves/hr-approvals/").status_code == 403,
)

approved = vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Fine by me."})
check("the manager can approve", approved.status_code == 200, str(data(approved))[:120])
check(
    "it moves to HR rather than being finished",
    data(approved).get("status") == "pending_hr",
    str(data(approved).get("status")),
)

balances = data(asha.get("/api/v1/leave-balances/me/"))
el = next(row for row in balances if row["leave_type_code"] == "EL")
check(
    "D1: the manager approving does NOT spend the balance",
    float(el["used_days"]) == 0,
    f"used={el['used_days']}",
)

check(
    "the manager cannot then clear the HR stage as well",
    vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {}).status_code == 403,
)

# Rejection, on a second request.
second = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (start + timedelta(days=14)).isoformat(),
        "end_date": (start + timedelta(days=14)).isoformat(),
        "reason": "Walkthrough: to be rejected.",
    },
)
reject_id = data(second).get("id")

# Measure *after* the request is in, so the comparison is about the rejection.
reserved = data(asha.get("/api/v1/leave-balances/me/"))
el_reserved = next(row for row in reserved if row["leave_type_code"] == "EL")

rejected = vikram.post(f"/api/v1/leaves/{reject_id}/reject/", {"comment": "Release week."})
check("the manager can reject outright", rejected.status_code == 200, str(rejected.status_code))
check(
    "a rejection ends it",
    data(rejected).get("status") == "rejected",
    str(data(rejected).get("status")),
)

after = data(asha.get("/api/v1/leave-balances/me/"))
el_after = next(row for row in after if row["leave_type_code"] == "EL")
check(
    "rejecting releases the reserved day",
    float(el_after["pending_days"]) < float(el_reserved["pending_days"]),
    f"{el_reserved['pending_days']} -> {el_after['pending_days']}",
)

# ---------------------------------------------------------------------------
scenario("Manager: timesheet approval")
# ---------------------------------------------------------------------------
sheets = data(vikram.get("/api/v1/timesheets/pending-approvals/"))
check(
    "the timesheet queue loads", "results" in sheets or isinstance(sheets, list), str(type(sheets))
)
pending = sheets.get("results", [])
note(f"{len(pending)} timesheet(s) awaiting this manager")

if pending:
    sheet_id = pending[0]["id"]
    detail = data(vikram.get(f"/api/v1/timesheets/{sheet_id}/"))
    check(
        "the manager can open the breakdown",
        bool(detail.get("entries")),
        str(len(detail.get("entries", []))),
    )
    check(
        "F5: the task descriptions are visible to the approver",
        all(entry.get("description") for entry in detail.get("entries", [])),
        str([e.get("description") for e in detail.get("entries", [])][:3]),
    )

    decided = vikram.post(f"/api/v1/timesheets/{sheet_id}/approve/", {"comment": "Looks right."})
    check(
        "the manager can approve a timesheet", decided.status_code == 200, str(decided.status_code)
    )
    check("an approved sheet is locked", data(decided).get("is_editable") is False)

# ---------------------------------------------------------------------------
scenario("Manager: scoping and limits")
# ---------------------------------------------------------------------------
own = data(vikram.get("/api/v1/employees/me/"))
own_leave = vikram.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (start + timedelta(days=60)).isoformat(),
        "end_date": (start + timedelta(days=60)).isoformat(),
        "reason": "Walkthrough: the manager's own leave.",
    },
)
own_id = data(own_leave).get("id")
check(
    "a manager can apply for their own leave",
    own_leave.status_code == 201,
    str(own_leave.status_code),
)

queue_again = data(vikram.get("/api/v1/leaves/pending-approvals/"))
check(
    "their own request is not in their own queue",
    all(row["id"] != own_id for row in queue_again.get("results", [])),
    str([r["id"] for r in queue_again.get("results", [])]),
)
check(
    "and they cannot approve it",
    vikram.post(f"/api/v1/leaves/{own_id}/approve/", {}).status_code == 403,
)

# Outside the branch.
stranger = outsider.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "reason": "Walkthrough: someone else's report.",
    },
)
stranger_id = data(stranger).get("id")
check(
    "a manager cannot approve outside their branch",
    vikram.post(f"/api/v1/leaves/{stranger_id}/approve/", {}).status_code in (403, 404),
)

# Pay is not a manager's business.
check(
    "a manager cannot see a report's bank details",
    vikram.get(f"/api/v1/employees/{own.get('id', 0) and 5}/bank-account/").status_code == 403,
)
check("a manager cannot see payroll runs", vikram.get("/api/v1/payroll-runs/").status_code == 403)
check(
    "a manager cannot reach the Finance queue",
    vikram.get("/api/v1/finance/approvals/").status_code == 403,
)
check(
    "a manager cannot request an account closure",
    vikram.post(
        "/api/v1/employees/5/deletion-request/", {"reason": "Walkthrough attempt."}
    ).status_code
    == 403,
)

# Reports a manager *should* have.
for label, path in [
    ("leave report", "/api/v1/reports/leave/"),
    ("timesheet report", "/api/v1/reports/timesheet/"),
    ("project report", "/api/v1/reports/projects/"),
]:
    check(f"the manager can run the {label}", vikram.get(path).status_code == 200)
check("but not the employee report", vikram.get("/api/v1/reports/employees/").status_code == 403)

raise SystemExit(summarise())
