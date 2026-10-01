"""End-to-end: an admin raises an account, and its owner signs in with it."""

import json

from django.test import Client
from e2e_harness import Persona, check, data, note, scenario, summarise

rahul = Persona("rahul.iyer@trigyan.io", "Admin")
priya = Persona("priya.menon@trigyan.io", "HR")
asha = Persona("asha.rao@trigyan.io", "Employee")

URL = "/api/v1/admin/users/"
EMAIL = "e2e.contractor@trigyan.io"
TEMP = "Welcome@2026"
CHOSEN = "TheirOwn@Pass26"


def anon():
    return Client()


def post(client, path, body, token=None):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.post(path, json.dumps(body), content_type="application/json", **headers)


def get(client, path, token=None):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.get(path, **headers)


# ---------------------------------------------------------------------------
scenario("Add user: only an administrator may")
# ---------------------------------------------------------------------------
for label, persona in (("HR", priya), ("an employee", asha)):
    refused = persona.post(URL, {"email": "nope@trigyan.io", "temporary_password": TEMP})
    check(f"{label} cannot create an account", refused.status_code == 403, str(refused.status_code))

# ---------------------------------------------------------------------------
scenario("Add user: the account is created and stored")
# ---------------------------------------------------------------------------
created = rahul.post(
    URL,
    {
        "email": "E2E.Contractor@trigyan.io",
        "temporary_password": TEMP,
        "first_name": "Meera",
        "last_name": "Das",
    },
)
check("an admin can create an account", created.status_code == 201, str(data(created))[:180])
check(
    "the email is stored lower-cased",
    data(created).get("email") == EMAIL,
    str(data(created).get("email")),
)
check(
    "and flagged to change the password at first sign-in",
    data(created).get("must_change_password") is True,
    str(data(created).get("must_change_password")),
)
check(
    "the name came through",
    data(created).get("full_name") == "Meera Das",
    str(data(created).get("full_name")),
)
check(
    "it starts as an employee, nothing more",
    data(created).get("roles") == ["employee"],
    str(data(created).get("roles")),
)

listed = data(rahul.get(URL, search="e2e.contractor"))
check("it appears in the Users list", listed.get("count") == 1, str(listed.get("count")))

# ---------------------------------------------------------------------------
scenario("Add user: what was stored is what sign-in checks")
# ---------------------------------------------------------------------------
wrong = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": "guessing"})
check("a wrong password is refused", wrong.status_code == 400, str(wrong.status_code))

first = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": TEMP})
check("the temporary password signs them in", first.status_code == 200, str(data(first))[:160])
token = data(first).get("access")
check("and they are told to change it", data(first)["user"]["must_change_password"] is True)

# ---------------------------------------------------------------------------
scenario("Add user: the first-login workflow carries on unchanged")
# ---------------------------------------------------------------------------
changed = post(
    anon(),
    "/api/v1/auth/password/change/",
    {"current_password": TEMP, "new_password": CHOSEN},
    token,
)
check("they can set their own password", changed.status_code == 204, str(changed.status_code))
check("the session that changed it ends", get(anon(), "/api/v1/auth/me/", token).status_code == 401)
check(
    "the temporary password stops working",
    post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": TEMP}).status_code == 400,
)

again = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": CHOSEN})
check("the new password signs them in", again.status_code == 200, str(data(again))[:160])
check(
    "and they are no longer asked to change it",
    data(again)["user"]["must_change_password"] is False,
)

new_token = data(again).get("access")

# ---------------------------------------------------------------------------
scenario("The profile gate: shut until the profile is submitted, draft or not")
# ---------------------------------------------------------------------------
check(
    "auth/me still answers behind the gate",
    get(anon(), "/api/v1/auth/me/", new_token).status_code == 200,
)
check(
    "but the portal is shut until the profile is submitted",
    get(anon(), "/api/v1/employees/", new_token).status_code == 403,
)

me = get(anon(), "/api/v1/employees/me/", new_token)
check("their own record exists, raised with the account", me.status_code == 200)
employee_id = data(me).get("id")
check(
    "with a fresh employee code",
    str(data(me).get("employee_code", "")).startswith("TRG"),
    str(data(me).get("employee_code")),
)

halfway = post(
    anon(),
    f"/api/v1/employees/{employee_id}/profile-draft/",
    {"phone": "+91 90000 77777", "gender": "male"},
    new_token,
)
check("half a profile saves as a draft", halfway.status_code == 200, str(data(halfway))[:120])
check(
    "and a draft does not open the portal",
    get(anon(), "/api/v1/employees/", new_token).status_code == 403,
)
came_back = get(anon(), "/api/v1/employees/me/", new_token)
check(
    "the draft is there when they come back",
    data(came_back).get("phone") == "+91 90000 77777",
    str(data(came_back).get("phone")),
)

completed = post(
    anon(),
    f"/api/v1/employees/{employee_id}/complete-profile/",
    {
        "phone": "+91 90000 77777",
        "date_of_birth": "1999-02-11",
        "gender": "male",
        "blood_group": "B+",
        "permanent_address": "44 Jubilee Hills, Hyderabad",
        "current_address": "44 Jubilee Hills, Hyderabad",
        "emergency_contact_name": "A. Relative",
        "emergency_contact_phone": "+91 90000 88888",
    },
    new_token,
)
check("submitting the whole profile is accepted", completed.status_code == 200)

# A joiner starts as an employee: their own scope opens - the directory
# holds exactly themselves, and the employee modules answer - while
# anything above that station still refuses.
directory = get(anon(), "/api/v1/employees/", new_token)
check(
    "the portal opens: the scoped directory holds exactly themselves",
    directory.status_code == 200
    and data(directory).get("count") == 1
    and data(directory)["results"][0]["id"] == employee_id,
    f"{directory.status_code} count={data(directory).get('count')}",
)
check(
    "the employee modules answer",
    get(anon(), "/api/v1/leaves/", new_token).status_code == 200
    and get(anon(), "/api/v1/projects/", new_token).status_code == 200,
)
check(
    "while the admin module that created them still refuses",
    get(anon(), "/api/v1/admin/users/", new_token).status_code == 403,
)

# ---------------------------------------------------------------------------
scenario("Add user: what is refused")
# ---------------------------------------------------------------------------
duplicate = rahul.post(URL, {"email": EMAIL, "temporary_password": TEMP})
check(
    "the same email cannot be used twice", duplicate.status_code == 400, str(duplicate.status_code)
)

cased = rahul.post(URL, {"email": EMAIL.upper(), "temporary_password": TEMP})
check("nor the same email in different case", cased.status_code == 400, str(cased.status_code))

existing = rahul.post(URL, {"email": "asha.rao@trigyan.io", "temporary_password": TEMP})
check(
    "nor an address that already belongs to somebody",
    existing.status_code == 400,
    str(existing.status_code),
)

weak = rahul.post(URL, {"email": "e2e.weak@trigyan.io", "temporary_password": "12345678"})
check("a weak temporary password is refused", weak.status_code == 400, str(weak.status_code))

nameless = rahul.post(URL, {"temporary_password": TEMP})
check("the email is required", nameless.status_code == 400, str(nameless.status_code))

note(f"created {EMAIL}")
raise SystemExit(summarise())
