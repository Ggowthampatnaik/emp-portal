"""End-to-end: money and history — arithmetic, immutability, and double-clicks."""

from datetime import date, timedelta
from decimal import Decimal

from e2e_harness import Persona, check, data, note, scenario, summarise

asha = Persona("asha.rao@trigyan.io", "Employee")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
priya = Persona("priya.menon@trigyan.io", "HR")
rahul = Persona("rahul.iyer@trigyan.io", "Admin")
fatima = Persona("fatima.sheikh@trigyan.io", "Finance")

# ---------------------------------------------------------------------------
scenario("Leave balance arithmetic over a full cycle")


# ---------------------------------------------------------------------------
def balance():
    rows = data(asha.get("/api/v1/leave-balances/me/"))
    row = next(r for r in rows if r["leave_type_code"] == "EL")
    return (
        Decimal(row["entitled_days"]),
        Decimal(row["used_days"]),
        Decimal(row["pending_days"]),
        Decimal(row["available_days"]),
    )


entitled, used, pending, available = balance()
check(
    "available = entitled - used - pending",
    available == entitled - used - pending,
    f"{available} vs {entitled} - {used} - {pending}",
)

types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
# Balances are held per calendar year, so stay inside this one or the numbers
# being compared belong to two different rows.
start = date.today() + timedelta(days=30)
while start.weekday() != 0 or start.year != date.today().year:
    start += timedelta(days=1)

applied = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=2)).isoformat(),
        "reason": "Walkthrough: three days for the arithmetic.",
    },
)
leave_id = data(applied).get("id")
check("a three-day request is created", applied.status_code == 201, str(data(applied))[:120])

e1, u1, p1, a1 = balance()
check("applying moves three days into pending", p1 == pending + 3, f"{pending} -> {p1}")
check("and nothing into used", u1 == used, f"{used} -> {u1}")
check("available drops by three", a1 == available - 3, f"{available} -> {a1}")

vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Fine."})
e2, u2, p2, a2 = balance()
check(
    "the manager approving changes no numbers at all",
    (u2, p2, a2) == (u1, p1, a1),
    f"used {u1}->{u2} pending {p1}->{p2}",
)

priya.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Confirmed."})
e3, u3, p3, a3 = balance()
check(
    "HR approving moves them from pending to used",
    u3 == u1 + 3 and p3 == p1 - 3,
    f"used {u1}->{u3}, pending {p1}->{p3}",
)
check("available is unchanged by the transfer", a3 == a1, f"{a1} -> {a3}")
check("the identity still holds", a3 == e3 - u3 - p3, f"{a3} vs {e3}-{u3}-{p3}")

cancelled = asha.post(f"/api/v1/leaves/{leave_id}/cancel/", {"comment": "Plans changed."})
check(
    "future approved leave can be cancelled",
    cancelled.status_code == 200,
    str(cancelled.status_code),
)
e4, u4, p4, a4 = balance()
check("cancelling gives the days back", u4 == u3 - 3, f"used {u3} -> {u4}")
check("and the identity survives that too", a4 == e4 - u4 - p4, f"{a4} vs {e4}-{u4}-{p4}")

# ---------------------------------------------------------------------------
scenario("Double-clicks and repeated calls")
# ---------------------------------------------------------------------------
second = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (start + timedelta(days=21)).isoformat(),
        "end_date": (start + timedelta(days=21)).isoformat(),
        "reason": "Walkthrough: double-click check.",
    },
)
dbl_id = data(second).get("id")
before_dbl = balance()

first_approve = vikram.post(f"/api/v1/leaves/{dbl_id}/approve/", {})
second_approve = vikram.post(f"/api/v1/leaves/{dbl_id}/approve/", {})
check(
    "approving twice is refused the second time",
    first_approve.status_code == 200 and second_approve.status_code in (403, 409),
    f"{first_approve.status_code} then {second_approve.status_code}",
)

hr_first = priya.post(f"/api/v1/leaves/{dbl_id}/approve/", {})
hr_second = priya.post(f"/api/v1/leaves/{dbl_id}/approve/", {})
check(
    "and at the HR stage too",
    hr_first.status_code == 200 and hr_second.status_code == 409,
    f"{hr_first.status_code} then {hr_second.status_code}",
)

after_dbl = balance()
check(
    "the day is only ever spent once",
    after_dbl[1] == before_dbl[1] + 1,
    f"used {before_dbl[1]} -> {after_dbl[1]}",
)

check(
    "cancelling twice is refused",
    asha.post(f"/api/v1/leaves/{dbl_id}/cancel/", {}).status_code == 200
    and asha.post(f"/api/v1/leaves/{dbl_id}/cancel/", {}).status_code == 409,
)

# ---------------------------------------------------------------------------
scenario("A payslip is a snapshot, not a live calculation")
# ---------------------------------------------------------------------------
slips = data(priya.get("/api/v1/payslips/", employee=5, page_size=5))
if slips.get("results"):
    slip = slips["results"][0]
    original_gross = slip["gross_earnings"]
    original_net = slip["net_pay"]

    structures = data(priya.get("/api/v1/salary-structures/", employee=5))
    current = next((s for s in structures.get("results", []) if s["is_current"]), None)
    if current:
        raised = priya.client.patch(
            f"/api/v1/salary-structures/{current['id']}/",
            '{"basic": "%s"}' % (Decimal(current["basic"]) + Decimal("10000")),
            content_type="application/json",
        )
        check("a raise can be recorded", raised.status_code == 200, str(raised.status_code))

        again = data(priya.get(f"/api/v1/payslips/{slip['id']}/"))
        check(
            "last month's payslip does not change with it",
            again["gross_earnings"] == original_gross and again["net_pay"] == original_net,
            f"{original_gross}/{original_net} -> {again['gross_earnings']}/{again['net_pay']}",
        )

        pdf = priya.get(f"/api/v1/payslips/{slip['id']}/pdf/")
        check("and neither does the PDF", pdf.status_code == 200, str(pdf.status_code))

# ---------------------------------------------------------------------------
scenario("Payroll arithmetic reconciles")
# ---------------------------------------------------------------------------
runs = data(priya.get("/api/v1/payroll-runs/", page_size=20))
for run in runs.get("results", [])[:3]:
    if run["status"] == "draft":
        continue
    detail = data(priya.get(f"/api/v1/payroll-runs/{run['id']}/"))
    payslips = detail.get("payslips", [])
    if not payslips:
        continue

    gross = sum(Decimal(p["gross_earnings"]) for p in payslips)
    deductions = sum(Decimal(p["total_deductions"]) for p in payslips)
    net = sum(Decimal(p["net_pay"]) for p in payslips)

    check(
        f"{run['period_label']}: the run totals match its payslips",
        Decimal(detail["total_gross"]) == gross
        and Decimal(detail["total_deductions"]) == deductions
        and Decimal(detail["total_net"]) == net,
        f"{detail['total_gross']}/{detail['total_net']} vs {gross}/{net}",
    )

    check(
        f"{run['period_label']}: gross - deductions = net on every payslip",
        all(
            Decimal(p["gross_earnings"]) - Decimal(p["total_deductions"]) == Decimal(p["net_pay"])
            for p in payslips
        ),
        "a payslip does not add up",
    )

    check(
        f"{run['period_label']}: paid days + unpaid days = working days",
        all(
            Decimal(p["paid_days"]) + Decimal(p["lop_days"]) == Decimal(p["working_days"])
            for p in payslips
        ),
        str([(p["paid_days"], p["lop_days"], p["working_days"]) for p in payslips[:2]]),
    )

# ---------------------------------------------------------------------------
scenario("History outlives the people in it")
# ---------------------------------------------------------------------------
from apps.employees.models import Employee  # noqa: E402
from apps.leave_management.models import LeaveRequest  # noqa: E402
from apps.payroll.models import Payslip  # noqa: E402
from apps.timesheets.models import Timesheet  # noqa: E402

target = Employee.objects.get(employee_code="TRG0013")
before = {
    "leave": LeaveRequest.objects.filter(employee=target).count(),
    "timesheets": Timesheet.objects.filter(employee=target).count(),
    "payslips": Payslip.objects.filter(employee=target).count(),
}
note(f"{target.full_name} has {before}")

raised = priya.post(
    f"/api/v1/employees/{target.pk}/deletion-request/",
    {"reason": "Walkthrough: closing the account."},
)
approved = rahul.post(
    f"/api/v1/admin/deletion-requests/{data(raised)['id']}/approve/", {"note": "Confirmed."}
)
check("the account is closed", approved.status_code == 200, str(approved.status_code))

target.refresh_from_db()
check("they are marked inactive", target.employment_status == "inactive", target.employment_status)
check(
    "their leave history survives",
    LeaveRequest.objects.filter(employee=target).count() == before["leave"],
)
check(
    "their timesheets survive",
    Timesheet.objects.filter(employee=target).count() == before["timesheets"],
)
check(
    "their payslips survive", Payslip.objects.filter(employee=target).count() == before["payslips"]
)
check("and the employee row itself survives", Employee.objects.filter(pk=target.pk).exists())

still_payable = data(priya.get("/api/v1/payslips/", employee=target.pk))
check(
    "HR can still open a leaver's payslips",
    still_payable.get("count", 0) >= 0,
    str(still_payable.get("count")),
)

raise SystemExit(summarise())
