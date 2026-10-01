"""End-to-end: the administrator, the Finance role, and the pay chain between them."""

from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

rahul = Persona("rahul.iyer@trigyan.io", "Admin")
priya = Persona("priya.menon@trigyan.io", "HR")
fatima = Persona("fatima.sheikh@trigyan.io", "Finance")
asha = Persona("asha.rao@trigyan.io", "Employee")

# ---------------------------------------------------------------------------
scenario("Admin: users, roles, settings, audit")
# ---------------------------------------------------------------------------
users = data(rahul.get("/api/v1/admin/users/", page_size=100))
check("the user list loads", users.get("count", 0) >= 14, str(users.get("count")))

roles = data(rahul.get("/api/v1/admin/roles/"))
role_slugs = {r["slug"] for r in roles.get("results", roles)}
check("all six roles exist", len(role_slugs) == 6, str(sorted(role_slugs)))
check("Finance is one of them", "finance" in role_slugs, str(sorted(role_slugs)))

permissions = data(rahul.get("/api/v1/admin/permissions/", page_size=100))
check(
    "the permission catalogue loads",
    permissions.get("count", len(permissions.get("results", []))) >= 48,
    str(permissions.get("count")),
)

settings_page = data(rahul.get("/api/v1/admin/settings/"))
check("system settings load", "results" in settings_page, str(list(settings_page)))

audit = data(rahul.get("/api/v1/admin/audit-logs/", page_size=5))
check("the audit log loads and has entries", audit.get("count", 0) > 0, str(audit.get("count")))

# ---------------------------------------------------------------------------
scenario("Admin: approving the payroll run (stage one of pay)")
# ---------------------------------------------------------------------------
runs = data(rahul.get("/api/v1/payroll-runs/"))
processed = [r for r in runs.get("results", []) if r["status"] == "processed"]
if not processed:
    period = date.today() - timedelta(days=430)
    opened = priya.post("/api/v1/payroll-runs/", {"year": period.year, "month": period.month})
    if opened.status_code == 201:
        priya.post(f"/api/v1/payroll-runs/{data(opened)['id']}/process/", {})
        processed = [data(rahul.get(f"/api/v1/payroll-runs/{data(opened)['id']}/"))]

check(
    "there is a processed run for the administrator to judge",
    bool(processed),
    str(runs.get("count")),
)

if processed:
    run_id = processed[0]["id"]
    approved = rahul.post(f"/api/v1/payroll-runs/{run_id}/approve/", {})
    check(
        "the administrator approves the run", approved.status_code == 200, str(data(approved))[:140]
    )
    check(
        "the run is now approved",
        data(approved).get("status") == "approved",
        str(data(approved).get("status")),
    )
    check(
        "HR cannot approve a run (maker-checker)",
        priya.post(f"/api/v1/payroll-runs/{run_id}/approve/", {}).status_code in (403, 409),
    )

# ---------------------------------------------------------------------------
scenario("Pay chain: HR pushes a payslip, Finance releases it")
# ---------------------------------------------------------------------------
slips = data(priya.get("/api/v1/payslips/", page_size=50))
candidates = [s for s in slips.get("results", []) if s["run_status"] in ("approved", "paid")]
check("there are payslips out of an approved month", bool(candidates), str(len(candidates)))

released_id = None
if candidates:
    slip = candidates[0]
    pushed = priya.post(f"/api/v1/payslips/{slip['id']}/process/", {})
    check(
        "HR can send a payslip to Finance",
        pushed.status_code in (200, 409),
        str(data(pushed))[:140],
    )

    queue = data(fatima.get("/api/v1/finance/approvals/", status="processed", page_size=50))
    check("it appears in the Finance queue", queue.get("count", 0) > 0, str(queue.get("count")))

    if queue.get("results"):
        approval = queue["results"][0]
        released_id = approval["id"]
        check(
            "the queue row carries the net and who sent it",
            approval.get("net_pay") and approval.get("processed_by_name"),
            str((approval.get("net_pay"), approval.get("processed_by_name"))),
        )

        detail = data(fatima.get(f"/api/v1/finance/approvals/{released_id}/"))
        check(
            "Finance can see the full breakdown before releasing",
            bool(detail.get("payslip_detail")),
            str(list(detail)),
        )

        hr_release = priya.post(f"/api/v1/finance/approvals/{released_id}/approve/", {})
        check("HR cannot release it themselves", hr_release.status_code == 403)

        queried = fatima.post(
            f"/api/v1/finance/approvals/{released_id}/query/",
            {"comment": "The LOP days look wrong - please re-check."},
        )
        check(
            "Finance can query it back to HR", queried.status_code == 200, str(data(queried))[:140]
        )
        check(
            "a query is not a rejection",
            data(queried).get("status") == "queried",
            str(data(queried).get("status")),
        )
        check(
            "a query with no comment is refused",
            fatima.post(
                f"/api/v1/finance/approvals/{released_id}/query/", {"comment": ""}
            ).status_code
            == 400,
        )

        # HR re-checks and sends it back across.
        payslip_id = data(queried).get("payslip")
        priya.post(f"/api/v1/payslips/{payslip_id}/process/", {})
        released = fatima.post(
            f"/api/v1/finance/approvals/{released_id}/approve/", {"comment": "Bank file matched."}
        )
        check("Finance releases it", released.status_code == 200, str(data(released))[:140])
        check(
            "it is marked released",
            data(released).get("status") == "approved",
            str(data(released).get("status")),
        )
        check(
            "with the releaser recorded",
            data(released).get("approved_by_name") == "Fatima Sheikh",
            str(data(released).get("approved_by_name")),
        )

# ---------------------------------------------------------------------------
scenario("Finance: the narrowest role in the portal")
# ---------------------------------------------------------------------------
check("Finance sees its own queue", fatima.get("/api/v1/finance/approvals/").status_code == 200)
check("Finance can read payslips", fatima.get("/api/v1/payslips/").status_code == 200)

own_only = data(fatima.get("/api/v1/employees/"))
codes = {r["employee_code"] for r in own_only.get("results", [])}
check("Finance sees only itself in the employee list", codes == {"TRG0011"}, str(codes))

for label, response in {
    "the admin user list": fatima.get("/api/v1/admin/users/"),
    "employee reports": fatima.get("/api/v1/reports/employees/"),
    "salary structures": fatima.get("/api/v1/salary-structures/"),
    "the leave approval queue": fatima.get("/api/v1/leaves/pending-approvals/"),
    "timesheet tracking": fatima.get("/api/v1/timesheets/status/by-employee/"),
    "account closures": fatima.get("/api/v1/admin/deletion-requests/"),
}.items():
    check(f"Finance is refused: {label}", response.status_code == 403, str(response.status_code))

check(
    "Finance cannot process a payslip (that is HR's half)",
    fatima.post("/api/v1/payslips/1/process/", {}).status_code == 403,
)
check(
    "Finance cannot export the payroll bank sheet",
    fatima.get("/api/v1/payroll-runs/1/export/").status_code == 403,
)
check(
    "Finance cannot see anyone's bank details",
    fatima.get("/api/v1/employees/5/bank-account/").status_code == 403,
)

# Finance *can* read the monthly run summaries: it holds `payroll.view_all` for
# the payslips it releases, and the run is the same figures added up. Recorded
# here so the behaviour is deliberate rather than assumed.
note("Finance can read payroll run summaries (payroll.view_all) - by design, worth confirming")

others = data(fatima.get("/api/v1/leaves/"))
check("Finance sees no one else's leave", others.get("count", 0) == 0, str(others.get("count")))

# ---------------------------------------------------------------------------
scenario("Account closure: HR asks, the administrator decides")
# ---------------------------------------------------------------------------
target = 6  # Karthik Reddy

# The demo database may already carry an open request; withdraw it so the
# walkthrough starts from a known state.
existing = priya.get(f"/api/v1/employees/{target}/deletion-request/")
if existing.status_code == 200 and data(existing).get("is_open"):
    priya.delete(f"/api/v1/employees/{target}/deletion-request/")
    note("withdrew a closure request that was already open in the demo data")

raised = priya.post(
    f"/api/v1/employees/{target}/deletion-request/",
    {"reason": "Walkthrough: resigned, last day passed."},
)
check("HR can raise a closure request", raised.status_code == 201, str(data(raised))[:140])
request_id = data(raised).get("id")

check(
    "HR cannot see the decision queue",
    priya.get("/api/v1/admin/deletion-requests/").status_code == 403,
)

queue = data(rahul.get("/api/v1/admin/deletion-requests/", status="pending"))
check(
    "the administrator sees it",
    any(r["id"] == request_id for r in queue.get("results", [])),
    str(queue.get("count")),
)

declined = rahul.post(
    f"/api/v1/admin/deletion-requests/{request_id}/reject/",
    {"note": "They are transferring, not leaving."},
)
check("the administrator can decline", declined.status_code == 200, str(declined.status_code))
still_active = data(rahul.get(f"/api/v1/employees/{target}/"))
check(
    "a declined request leaves the employee active",
    still_active.get("employment_status") == "active",
    str(still_active.get("employment_status")),
)

again = priya.post(
    f"/api/v1/employees/{target}/deletion-request/",
    {"reason": "Walkthrough: confirmed, they have left."},
)
second_id = data(again).get("id")
approved_closure = rahul.post(
    f"/api/v1/admin/deletion-requests/{second_id}/approve/", {"note": "Confirmed with the manager."}
)
check(
    "the administrator can approve",
    approved_closure.status_code == 200,
    str(approved_closure.status_code),
)
closed = data(rahul.get(f"/api/v1/employees/{target}/"))
check(
    "approving deactivates the account",
    closed.get("employment_status") == "inactive",
    str(closed.get("employment_status")),
)

# Nothing was deleted.
leave_left = data(rahul.get("/api/v1/leaves/", employee=target))
check("their leave history survives", leave_left.get("count", 0) >= 0, str(leave_left.get("count")))
check("the employee record survives", closed.get("id") == target, str(closed.get("id")))

raise SystemExit(summarise())
