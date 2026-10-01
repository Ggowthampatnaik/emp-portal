"""End-to-end: a new joiner registers, from temporary password to full member.

Walks the whole journey in order, as the SPA drives it - HR creates the account,
the new joiner activates it, sets a password, is signed out, signs back in,
completes the profile, and only then finds the rest of the portal open.
"""

from datetime import date

from django.test import Client
from e2e_harness import Persona, check, data, note, scenario, summarise

priya = Persona("priya.menon@trigyan.io", "HR")

TEMP = "Welcome@2026"
CHOSEN = "MyOwn@Pass2026"
EMAIL = "e2e.newjoiner2@trigyan.io"


def anon():
    return Client()


def post(client, path, body, token=None):
    import json

    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.post(path, json.dumps(body), content_type="application/json", **headers)


def get(client, path, token=None):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.get(path, **headers)


def pdf():
    """Profile documents are PDFs - the server checks the first five bytes."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile("cert.pdf", b"%PDF-1.4 a certificate", content_type="application/pdf")


# ---------------------------------------------------------------------------
scenario("1. HR creates the account with a temporary password")
# ---------------------------------------------------------------------------
created = priya.post(
    "/api/v1/employees/",
    {
        "email": EMAIL,
        "first_name": "Ravi",
        "last_name": "Kumar",
        "employee_code": "TRG7301",
        "date_of_joining": date.today().isoformat(),
        "designation": 1,
        "department": 1,
        "temporary_password": TEMP,
    },
)
check("HR can create the employee", created.status_code == 201, str(data(created))[:200])
new_id = data(created).get("id")
check(
    "they start as a first-time user",
    data(created).get("profile_completed") is False,
    str(data(created).get("profile_completed")),
)

# ---------------------------------------------------------------------------
scenario("2-3. The registration screen validates the temporary credentials")
# ---------------------------------------------------------------------------
wrong = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": "not-it"})
check("a wrong temporary password is refused", wrong.status_code == 400, str(wrong.status_code))

first = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": TEMP})
check("the real one is accepted", first.status_code == 200, str(data(first))[:160])
temp_token = data(first).get("access")
check(
    "and the account is flagged as needing a new password",
    data(first)["user"]["must_change_password"] is True,
    str(data(first)["user"]["must_change_password"]),
)

# ---------------------------------------------------------------------------
scenario("4-6. Only the change-password screen is reachable until it is done")
# ---------------------------------------------------------------------------
blocked = get(anon(), "/api/v1/leaves/", temp_token)
check("the portal itself is shut", blocked.status_code == 403, str(blocked.status_code))

weak = post(
    anon(),
    "/api/v1/auth/password/change/",
    {"current_password": TEMP, "new_password": "12345678"},
    temp_token,
)
check("a weak new password is refused", weak.status_code == 400, str(weak.status_code))

changed = post(
    anon(),
    "/api/v1/auth/password/change/",
    {"current_password": TEMP, "new_password": CHOSEN},
    temp_token,
)
check("the new password is accepted", changed.status_code == 204, str(changed.status_code))

# ---------------------------------------------------------------------------
scenario("7. The session ends the moment the password changes")
# ---------------------------------------------------------------------------
check(
    "the token that made the change is dead",
    get(anon(), "/api/v1/auth/me/", temp_token).status_code == 401,
)
check(
    "the temporary password no longer works",
    post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": TEMP}).status_code == 400,
)

# ---------------------------------------------------------------------------
scenario("8-9. Signing back in lands on the profile wizard")
# ---------------------------------------------------------------------------
second = post(anon(), "/api/v1/auth/login/", {"email": EMAIL, "password": CHOSEN})
check("the new password signs them in", second.status_code == 200, str(data(second))[:160])
token = data(second).get("access")
check(
    "they are no longer asked to change it", data(second)["user"]["must_change_password"] is False
)
check("but the profile is still incomplete", data(second)["user"]["profile_completed"] is False)
check("so the portal is still shut", get(anon(), "/api/v1/timesheets/", token).status_code == 403)
check(
    "while their own record stays reachable",
    get(anon(), "/api/v1/employees/me/", token).status_code == 200,
)

# ---------------------------------------------------------------------------
scenario("10-11. Completing the profile clears the first-time flag")
# ---------------------------------------------------------------------------
half = post(anon(), f"/api/v1/employees/{new_id}/complete-profile/", {"phone": "9876500011"}, token)
check("a half-filled wizard is refused", half.status_code == 400, str(half.status_code))

done = post(
    anon(),
    f"/api/v1/employees/{new_id}/complete-profile/",
    {
        "phone": "9876500011",
        "date_of_birth": "1998-04-12",
        "gender": "male",
        "blood_group": "O+",
        "permanent_address": "12 Jubilee Hills, Hyderabad",
        "current_address": "12 Jubilee Hills, Hyderabad",
        "emergency_contact_name": "Lakshmi Kumar",
        "emergency_contact_phone": "9876500012",
    },
    token,
)
check("a complete one is accepted", done.status_code == 200, str(data(done))[:200])
check(
    "and marks them as no longer first-time",
    data(done).get("profile_completed") is True,
    str(data(done).get("profile_completed")),
)

# ---------------------------------------------------------------------------
scenario("Registration done: the rest of the portal opens")
# ---------------------------------------------------------------------------
for label, path in [
    ("leave", "/api/v1/leaves/"),
    ("leave balances", "/api/v1/leave-balances/me/"),
    ("timesheets", "/api/v1/timesheets/"),
    ("projects", "/api/v1/projects/"),
    ("payslips", "/api/v1/payslips/"),
    ("the dashboard", "/api/v1/dashboard/summary/"),
    ("the directory", "/api/v1/employees/directory/"),
]:
    response = get(anon(), path, token)
    check(f"{label} is now open", response.status_code == 200, str(response.status_code))

everyone = data(priya.get("/api/v1/employees/", search="Ravi"))
check(
    "HR sees them in the employee list", everyone.get("count", 0) >= 1, str(everyone.get("count"))
)

# ---------------------------------------------------------------------------
scenario("12-13. The optional extras on their own profile")
# ---------------------------------------------------------------------------
vocabulary = data(get(anon(), "/api/v1/skills/?page_size=200", token))
skills = vocabulary.get("results", [])
check("the skill vocabulary is readable for the picker", len(skills) > 20, str(len(skills)))

typed = data(get(anon(), "/api/v1/skills/?q=pyth", token))
check(
    "typing filters it down",
    0 < typed.get("count", 0) < len(skills),
    f"{typed.get('count')} of {len(skills)}",
)

chosen = [row["id"] for row in skills[:2]]
saved = anon().put(
    f"/api/v1/employees/{new_id}/skills/",
    __import__("json").dumps(
        {"skills": [{"skill": sid, "proficiency": "intermediate"} for sid in chosen]}
    ),
    content_type="application/json",
    HTTP_AUTHORIZATION=f"Bearer {token}",
)
check("they can add skills to their own profile", saved.status_code == 200, str(data(saved))[:160])
check("and both stuck", len(data(saved)) == 2, str(len(data(saved))))

# Every document category the brief asks for.
CATEGORIES = [
    ("tenth", "10th certificate"),
    ("intermediate", "12th certificate"),
    ("bachelors", "Bachelor's certificate"),
    ("masters", "Master's certificate"),
    ("skill_certificate", "AWS Solutions Architect"),
    ("other_education", "Other educational document"),
    ("experience_letter", "Experience document"),
    ("other", "Other relevant document"),
]
for kind, title in CATEGORIES:
    response = anon().post(
        f"/api/v1/employees/{new_id}/documents/",
        {"document_type": kind, "title": title, "file": pdf()},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    check(f"they can attach a {title}", response.status_code == 201, str(data(response))[:140])

attached = data(get(anon(), f"/api/v1/employees/{new_id}/documents/", token))
check("all seven are on the record", len(attached) == len(CATEGORIES), str(len(attached)))
check(
    "each comes back with a URL to open",
    all(row.get("file_url") for row in attached),
    str(attached[:1])[:160],
)

removed = anon().delete(
    f"/api/v1/employees/{new_id}/documents/{attached[0]['id']}/",
    HTTP_AUTHORIZATION=f"Bearer {token}",
)
check("and they can take one back off again", removed.status_code == 204, str(removed.status_code))

experience = anon().put(
    f"/api/v1/employees/{new_id}/experience/",
    __import__("json").dumps(
        {
            "experience": [
                {
                    "company_name": "Previous Co",
                    "job_title": "Junior Developer",
                    "from_date": "2021-06-01",
                    "to_date": None,
                    "description": "Built things.",
                }
            ]
        }
    ),
    content_type="application/json",
    HTTP_AUTHORIZATION=f"Bearer {token}",
)
check(
    "they can record previous employment",
    experience.status_code == 200,
    str(data(experience))[:160],
)
check(
    "a blank end date reads as the job they left to join",
    data(experience)[0].get("is_current") is True,
    str(data(experience)[0].get("is_current")),
)

check(
    "none of it was mandatory - the portal was already open",
    get(anon(), "/api/v1/leaves/", token).status_code == 200,
)

note(f"registered employee id {new_id} ({EMAIL})")
raise SystemExit(summarise())
