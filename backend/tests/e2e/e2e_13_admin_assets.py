"""End-to-end: the admin Assets page - everyone, and what each of them holds."""

from e2e_harness import Persona, check, data, note, scenario, summarise

vinod = Persona("rahul.iyer@trigyan.io", "Admin")
priya = Persona("priya.menon@trigyan.io", "HR")
asha = Persona("asha.rao@trigyan.io", "Employee")

ASHA = 5
KARTHIK = 6

# ---------------------------------------------------------------------------
scenario("Admin assets: the page lists everyone with a count")
# ---------------------------------------------------------------------------
issued = vinod.post(
    f"/api/v1/employees/{ASHA}/assets/",
    {"name": "MacBook Pro 14", "brand": "Apple", "serial_number": "E2E-ADM-0001"},
)
check("an admin can issue an asset", issued.status_code == 201, str(data(issued))[:160])
asset_id = data(issued).get("id")

everyone = data(vinod.get("/api/v1/employees/", page_size=100))
rows = everyone.get("results", [])
check("the page lists the whole company", len(rows) >= 14, str(len(rows)))
check(
    "every row carries a count", all("asset_count" in row for row in rows), str(list(rows[0])[:20])
)

counts = {row["employee_code"]: row["asset_count"] for row in rows}
check(
    "the holder's count reflects what was issued",
    counts.get("TRG0005", 0) >= 1,
    str(counts.get("TRG0005")),
)
check(
    "somebody holding nothing still appears with a zero",
    any(v == 0 for v in counts.values()),
    str(sorted(counts.values()))[:120],
)

# ---------------------------------------------------------------------------
scenario("Admin assets: the search box")
# ---------------------------------------------------------------------------
found = data(vinod.get("/api/v1/employees/", search="Asha"))
check("searching narrows the list", found.get("count") == 1, str(found.get("count")))
check(
    "and the count comes with it",
    found["results"][0].get("asset_count", 0) >= 1,
    str(found["results"][0].get("asset_count")),
)

by_code = data(vinod.get("/api/v1/employees/", search="TRG0006"))
check("searching by employee code works", by_code.get("count") == 1, str(by_code.get("count")))

nobody = data(vinod.get("/api/v1/employees/", search="zzzznotaperson"))
check(
    "a search matching nobody is empty, not an error",
    nobody.get("count") == 0,
    str(nobody.get("count")),
)

# ---------------------------------------------------------------------------
scenario("Admin assets: expanding a row")
# ---------------------------------------------------------------------------
held = vinod.get(f"/api/v1/employees/{ASHA}/assets/")
check("expanding fetches that employee's assets", held.status_code == 200, str(held.status_code))
serials = [row["serial_number"] for row in data(held)]
check("the issued asset is listed", "E2E-ADM-0001" in serials, str(serials))
check(
    "each carries the four details the form asks for",
    all(
        all(k in row for k in ("serial_number", "name", "brand", "photo_url")) for row in data(held)
    ),
    str(list(data(held)[0])),
)

other = data(vinod.get(f"/api/v1/employees/{KARTHIK}/assets/"))
check(
    "a different row shows only that person's kit",
    "E2E-ADM-0001" not in [r["serial_number"] for r in other],
    str([r["serial_number"] for r in other]),
)

# ---------------------------------------------------------------------------
scenario("Admin assets: issuing from the page")
# ---------------------------------------------------------------------------
second = vinod.post(
    f"/api/v1/employees/{KARTHIK}/assets/",
    {"name": "Dell U2723", "brand": "Dell", "serial_number": "e2e-adm-0002"},
)
check(
    "the admin can issue to anyone from the page",
    second.status_code == 201,
    str(data(second))[:160],
)
check(
    "the serial is normalised",
    data(second).get("serial_number") == "E2E-ADM-0002",
    str(data(second).get("serial_number")),
)

after = data(vinod.get("/api/v1/employees/", search="Karthik"))
check(
    "the count updates after issuing",
    after["results"][0].get("asset_count", 0) >= 1,
    str(after["results"][0].get("asset_count")),
)

clash = vinod.post(
    f"/api/v1/employees/{ASHA}/assets/",
    {"name": "Another", "brand": "Apple", "serial_number": "E2E-ADM-0002"},
)
check("the same serial cannot go to two people", clash.status_code == 400, str(clash.status_code))

# ---------------------------------------------------------------------------
scenario("Admin assets: HR reaches the same page")
# ---------------------------------------------------------------------------
check(
    "HR holds asset.manage, so the page is theirs too",
    priya.post(
        f"/api/v1/employees/{ASHA}/assets/",
        {"name": "Keyboard", "brand": "Logitech", "serial_number": "E2E-ADM-0003"},
    ).status_code
    == 201,
)

# ---------------------------------------------------------------------------
scenario("Admin assets: an employee sees their own, and only their own")
# ---------------------------------------------------------------------------
mine = asha.get(f"/api/v1/employees/{ASHA}/assets/")
check("an employee sees what they hold", mine.status_code == 200, str(mine.status_code))
check(
    "including what the admin just issued",
    "E2E-ADM-0001" in [r["serial_number"] for r in data(mine)],
    str([r["serial_number"] for r in data(mine)]),
)
check(
    "but cannot issue themselves anything",
    asha.post(
        f"/api/v1/employees/{ASHA}/assets/",
        {"name": "Steam Deck", "brand": "Valve", "serial_number": "E2E-ADM-9999"},
    ).status_code
    == 403,
)
check(
    "nor take one off their record",
    asha.delete(f"/api/v1/employees/{ASHA}/assets/{asset_id}/").status_code == 403,
)
check(
    "nor look at a colleague's",
    asha.get(f"/api/v1/employees/{KARTHIK}/assets/").status_code in (403, 404),
)

# ---------------------------------------------------------------------------
scenario("Admin assets: taking one back")
# ---------------------------------------------------------------------------
before = data(vinod.get("/api/v1/employees/", search="Asha"))["results"][0]["asset_count"]
returned = vinod.delete(f"/api/v1/employees/{ASHA}/assets/{asset_id}/")
check("the admin can take an asset back", returned.status_code == 204, str(returned.status_code))
now = data(vinod.get("/api/v1/employees/", search="Asha"))["results"][0]["asset_count"]
check("the count drops with it", now == before - 1, f"{before} -> {now}")

note("admin assets page exercised end to end")
raise SystemExit(summarise())
