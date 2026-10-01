"""End-to-end: company assets on the employee page."""

from io import BytesIO

from e2e_harness import Persona, check, data, note, scenario, summarise

priya = Persona("priya.menon@trigyan.io", "HR")
vikram = Persona("vikram.nair@trigyan.io", "Manager")
asha = Persona("asha.rao@trigyan.io", "Employee")
karthik = Persona("karthik.reddy@trigyan.io", "Employee")


def png(name="asset.png"):
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (40, 40), "#4A7CBE").save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


ASHA = 5
KARTHIK = 6

# ---------------------------------------------------------------------------
scenario("Assets: HR issues kit")
# ---------------------------------------------------------------------------
issued = priya.post(
    f"/api/v1/employees/{ASHA}/assets/",
    {"name": "MacBook Pro 14", "brand": "Apple", "serial_number": "e2e-c02xy999"},
)
check("HR can issue an asset", issued.status_code == 201, str(data(issued))[:160])
asset_id = data(issued).get("id")
check(
    "the serial is stored upper-case",
    data(issued).get("serial_number") == "E2E-C02XY999",
    str(data(issued).get("serial_number")),
)
check("an asset without a photo is fine", data(issued).get("photo_url") is None)

with_photo = priya.post(
    f"/api/v1/employees/{ASHA}/assets/",
    {"name": "Dell U2723", "brand": "Dell", "serial_number": "E2E-CN0AB111", "photo": png()},
    multipart=True,
)
check("a photo can be attached", with_photo.status_code == 201, str(data(with_photo))[:160])
check(
    "and comes back as a URL the SPA can render",
    bool(data(with_photo).get("photo_url")),
    str(data(with_photo).get("photo_url")),
)
check("the file itself is never echoed back", "photo" not in data(with_photo))

# ---------------------------------------------------------------------------
scenario("Assets: the serial number is the identity")
# ---------------------------------------------------------------------------
clash = priya.post(
    f"/api/v1/employees/{KARTHIK}/assets/",
    {"name": "MacBook Pro 14", "brand": "Apple", "serial_number": "E2E-C02XY999"},
)
check(
    "the same serial cannot be out with two people",
    clash.status_code == 400,
    str(clash.status_code),
)
message = " ".join(data(clash).get("error", {}).get("details", {}).get("serial_number", []))
check("and the refusal names who holds it", "TRG0005" in message, message[:140])

lower = priya.post(
    f"/api/v1/employees/{KARTHIK}/assets/",
    {"name": "MacBook Pro 14", "brand": "Apple", "serial_number": "e2e-c02xy999"},
)
check("lower case does not slip a duplicate past", lower.status_code == 400, str(lower.status_code))

for field in ("name", "brand", "serial_number"):
    payload = {"name": "X", "brand": "Y", "serial_number": "E2E-ZZZ1"}
    payload.pop(field)
    response = priya.post(f"/api/v1/employees/{ASHA}/assets/", payload)
    check(f"{field} is required", response.status_code == 400, str(response.status_code))

# ---------------------------------------------------------------------------
scenario("Assets: who can see them")
# ---------------------------------------------------------------------------
mine = asha.get(f"/api/v1/employees/{ASHA}/assets/")
check("an employee sees their own kit", mine.status_code == 200, str(mine.status_code))
serials = sorted(row["serial_number"] for row in data(mine))
# A subset check, not an exact list: the demo database carries whatever has
# been issued through the portal for real, and this walkthrough should not
# break because somebody actually used the feature.
check("both items are listed", {"E2E-C02XY999", "E2E-CN0AB111"} <= set(serials), str(serials))

team = vikram.get(f"/api/v1/employees/{ASHA}/assets/")
check("a reporting manager sees their team's kit", team.status_code == 200, str(team.status_code))

peer = karthik.get(f"/api/v1/employees/{ASHA}/assets/")
check(
    "a colleague cannot - they cannot open the record at all",
    peer.status_code in (403, 404),
    str(peer.status_code),
)

# ---------------------------------------------------------------------------
scenario("Assets: who can change them")
# ---------------------------------------------------------------------------
check(
    "an employee cannot issue themselves a laptop",
    asha.post(
        f"/api/v1/employees/{ASHA}/assets/",
        {"name": "Steam Deck", "brand": "Valve", "serial_number": "E2E-SD1"},
    ).status_code
    == 403,
)
check(
    "nor amend one",
    asha.patch(f"/api/v1/employees/{ASHA}/assets/{asset_id}/", {"brand": "Mine now"}).status_code
    == 403,
)
check(
    "nor take one off the record",
    asha.delete(f"/api/v1/employees/{ASHA}/assets/{asset_id}/").status_code == 403,
)
check(
    "a manager cannot issue kit to their own team",
    vikram.post(
        f"/api/v1/employees/{ASHA}/assets/",
        {"name": "Monitor", "brand": "LG", "serial_number": "E2E-LG1"},
    ).status_code
    == 403,
)

amended = priya.patch(f"/api/v1/employees/{ASHA}/assets/{asset_id}/", {"brand": "Apple Inc."})
check("HR can correct a detail", amended.status_code == 200, str(data(amended))[:120])
check(
    "the correction stuck",
    data(amended).get("brand") == "Apple Inc.",
    str(data(amended).get("brand")),
)

same = priya.patch(
    f"/api/v1/employees/{ASHA}/assets/{asset_id}/", {"serial_number": "E2E-C02XY999"}
)
check(
    "editing an asset does not trip over its own serial",
    same.status_code == 200,
    str(data(same))[:120],
)

wrong_person = priya.patch(f"/api/v1/employees/{KARTHIK}/assets/{asset_id}/", {"brand": "Nope"})
check(
    "an asset is only reachable through the person holding it",
    wrong_person.status_code == 404,
    str(wrong_person.status_code),
)

# ---------------------------------------------------------------------------
scenario("Assets: taking them back")
# ---------------------------------------------------------------------------
returned = priya.delete(f"/api/v1/employees/{ASHA}/assets/{asset_id}/")
check("HR can take an asset back", returned.status_code == 204, str(returned.status_code))
left = data(priya.get(f"/api/v1/employees/{ASHA}/assets/"))
check(
    "it is off the list",
    "E2E-C02XY999" not in [r["serial_number"] for r in left],
    str([r["serial_number"] for r in left]),
)

reissued = priya.post(
    f"/api/v1/employees/{KARTHIK}/assets/",
    {"name": "MacBook Pro 14", "brand": "Apple", "serial_number": "E2E-C02XY999"},
)
check("and the serial is free to reissue", reissued.status_code == 201, str(data(reissued))[:120])

note(f"assets exercised on employees {ASHA} and {KARTHIK}")
raise SystemExit(summarise())
