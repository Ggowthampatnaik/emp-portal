"""End-to-end: the HR changes, and the leave-balance year fix."""

from datetime import date, timedelta

from e2e_harness import Persona, check, data, note, scenario, summarise

priya = Persona("priya.menon@trigyan.io", "HR")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
asha = Persona("asha.rao@trigyan.io", "Employee")

scenario("HR never rejects leave")
types = data(asha.get("/api/v1/leave-types/", is_active=True))
earned = next(t for t in types["results"] if t["code"] == "EL")
# Deliberately inside this year: the year test below books next year, and the
# two must not collide.
start = date.today() + timedelta(days=45)
while start.weekday() != 0 or start.year != date.today().year:
    start += timedelta(days=1)

applied = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "reason": "Walkthrough: HR reject check.",
    },
)
leave_id = data(applied).get("id")

refused = priya.post(f"/api/v1/leaves/{leave_id}/reject/", {"comment": "No."})
check("HR is refused at stage one", refused.status_code == 403, str(refused.status_code))
check(
    "and told what to do instead",
    "back to the reporting manager" in data(refused).get("error", {}).get("message", ""),
    str(data(refused).get("error", {}).get("message")),
)

still = data(asha.get(f"/api/v1/leaves/{leave_id}/"))
check(
    "the request is untouched", still.get("status") == "pending_manager", str(still.get("status"))
)

vikram.post(f"/api/v1/leaves/{leave_id}/approve/", {"comment": "Fine."})
hr_reject = priya.post(f"/api/v1/leaves/{leave_id}/reject/", {"comment": "No."})
check(
    "HR is refused at stage two as well",
    hr_reject.status_code in (403, 409),
    str(hr_reject.status_code),
)

sent_back = priya.post(
    f"/api/v1/leaves/{leave_id}/send-back/", {"comment": "Please re-check the cover that week."}
)
check(
    "send back is HR's way of disagreeing", sent_back.status_code == 200, str(sent_back.status_code)
)
check(
    "and it returns to the manager",
    data(sent_back).get("status") == "pending_manager",
    str(data(sent_back).get("status")),
)

scenario("The manager still rejects, as before")
second = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": (start + timedelta(days=14)).isoformat(),
        "end_date": (start + timedelta(days=14)).isoformat(),
        "reason": "Walkthrough: manager reject.",
    },
)
rejected = vikram.post(f"/api/v1/leaves/{data(second)['id']}/reject/", {"comment": "Release week."})
check("the manager can reject", rejected.status_code == 200, str(rejected.status_code))
check(
    "which ends the request",
    data(rejected).get("status") == "rejected",
    str(data(rejected).get("status")),
)

scenario("Leave balances answer for the year asked for")
this_year = date.today().year
for year in (this_year, this_year + 1):
    rows = data(asha.get("/api/v1/leave-balances/me/", year=year))
    row = next((r for r in rows if r["leave_type_code"] == "EL"), None)
    check(f"the {year} balance loads", row is not None, str(len(rows)))
    if row:
        check(f"and is labelled {year}", row["year"] == year, str(row["year"]))

next_year = date(this_year + 1, 2, 1)
while next_year.weekday() != 0:
    next_year += timedelta(days=1)
before = next(
    (
        r
        for r in data(asha.get("/api/v1/leave-balances/me/", year=this_year + 1))
        if r["leave_type_code"] == "EL"
    ),
    {},
)
booked = asha.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": next_year.isoformat(),
        "end_date": next_year.isoformat(),
        "reason": "Walkthrough: next year's leave.",
    },
)
check("leave can be booked into next year", booked.status_code == 201, str(data(booked))[:120])

after_next = next(
    (
        r
        for r in data(asha.get("/api/v1/leave-balances/me/", year=this_year + 1))
        if r["leave_type_code"] == "EL"
    ),
    {},
)
after_this = next(
    (
        r
        for r in data(asha.get("/api/v1/leave-balances/me/", year=this_year))
        if r["leave_type_code"] == "EL"
    ),
    {},
)
check(
    "it is reserved against next year",
    float(after_next["pending_days"]) == float(before.get("pending_days", 0)) + 1,
    f"{before.get('pending_days')} -> {after_next['pending_days']}",
)
note(
    f"this year's pending is separately {after_this['pending_days']} - two different rows, "
    "which is exactly what the year selector now makes visible"
)

raise SystemExit(summarise())
