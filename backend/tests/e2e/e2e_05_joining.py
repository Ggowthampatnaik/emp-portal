"""End-to-end: a brand new joiner's first hour, and getting back in after a lockout."""

from datetime import date, timedelta

from django.core import mail
from django.test import Client
from e2e_harness import Persona, check, data, note, scenario, summarise

priya = Persona("priya.menon@trigyan.io", "HR")
anon = Client()

TEMPORARY = "Welcome@2026"
NEW_EMAIL = "e2e.joiner@trigyan.io"


def login(email: str, password: str):
    return anon.post(
        "/api/v1/auth/login/",
        {"email": email, "password": password},
        content_type="application/json",
    )


def temporary_from_email() -> str:
    body = mail.outbox[-1].body
    return next(line.strip() for line in body.splitlines() if line.startswith("    "))


# ---------------------------------------------------------------------------
scenario("New joiner: HR issues credentials")
# ---------------------------------------------------------------------------
created = priya.post(
    "/api/v1/employees/",
    {
        "email": NEW_EMAIL,
        "first_name": "Meena",
        "last_name": "Iyer",
        "employee_code": "TRG7100",
        "date_of_joining": date.today().isoformat(),
        "designation": 1,
        "department": 1,
        "temporary_password": TEMPORARY,
    },
)
check("HR creates the account", created.status_code == 201, str(data(created))[:160])
employee_id = data(created).get("id")

check(
    "there is no self-signup endpoint",
    anon.post("/api/v1/auth/register/", {}, content_type="application/json").status_code == 404,
)

# ---------------------------------------------------------------------------
scenario("New joiner: first sign-in is a forced password change")
# ---------------------------------------------------------------------------
first = login(NEW_EMAIL, TEMPORARY)
check(
    "they can sign in with the temporary password", first.status_code == 200, str(data(first))[:160]
)
identity = data(first).get("user", {})
check(
    "the portal knows the password must change",
    identity.get("must_change_password") is True,
    str(identity.get("must_change_password")),
)
check(
    "and that the profile is not done",
    identity.get("profile_completed") is False,
    str(identity.get("profile_completed")),
)

joiner = Client(HTTP_AUTHORIZATION=f"Bearer {data(first)['access']}")

changed = joiner.post(
    "/api/v1/auth/password/change/",
    {"current_password": TEMPORARY, "new_password": "Chosen@2026"},
    content_type="application/json",
)
check("they can set their own password", changed.status_code == 204, str(changed.status_code))
check("the temporary password no longer works", login(NEW_EMAIL, TEMPORARY).status_code == 400)
after_change = login(NEW_EMAIL, "Chosen@2026")
check("the new one does", after_change.status_code == 200, str(after_change.status_code))
check(
    "the forced-change flag is cleared", data(after_change)["user"]["must_change_password"] is False
)

joiner = Client(HTTP_AUTHORIZATION=f"Bearer {data(after_change)['access']}")

# ---------------------------------------------------------------------------
scenario("New joiner: the Complete Profile gate")
# ---------------------------------------------------------------------------
shut = {
    "the dashboard": "/api/v1/dashboard/summary/",
    "leave": "/api/v1/leaves/",
    "timesheets": "/api/v1/timesheets/",
    "projects": "/api/v1/projects/",
    "payslips": "/api/v1/payslips/",
    "the directory": "/api/v1/employees/directory/",
    "the employee list": "/api/v1/employees/",
}
for label, path in shut.items():
    response = joiner.get(path)
    check(f"the gate closes {label}", response.status_code == 403, str(response.status_code))

allowed = {
    "their own identity": "/api/v1/auth/me/",
    "their own record": "/api/v1/employees/me/",
    "the department list the form needs": "/api/v1/departments/",
    "the skill list": "/api/v1/skills/",
}
for label, path in allowed.items():
    check(f"but the wizard can still read {label}", joiner.get(path).status_code == 200)

check(
    "signing out is always possible",
    joiner.post("/api/v1/auth/logout/", {}, content_type="application/json").status_code == 204,
)

half = joiner.post(
    f"/api/v1/employees/{employee_id}/complete-profile/",
    {"phone": "+91 90000 11111", "date_of_birth": "1997-03-04"},
    content_type="application/json",
)
check("a half-filled profile is refused", half.status_code == 400, str(half.status_code))
check("and the gate stays shut", joiner.get("/api/v1/leaves/").status_code == 403)

full = joiner.post(
    f"/api/v1/employees/{employee_id}/complete-profile/",
    {
        "phone": "+91 90000 11111",
        "date_of_birth": "1997-03-04",
        "gender": "female",
        "blood_group": "A+",
        "permanent_address": "5 Residency Road, Bengaluru",
        "current_address": "5 Residency Road, Bengaluru",
        "emergency_contact_name": "Lakshmi Iyer",
        "emergency_contact_phone": "+91 90000 22222",
    },
    content_type="application/json",
)
check("a complete profile is accepted", full.status_code == 200, str(data(full))[:160])
check("the flag flips", data(full).get("profile_completed") is True)

for label, path in shut.items():
    check(
        f"the portal opens: {label}",
        joiner.get(path).status_code == 200,
        str(joiner.get(path).status_code),
    )

# ---------------------------------------------------------------------------
scenario("New joiner: doing something on day one")
# ---------------------------------------------------------------------------
types = data(joiner.get("/api/v1/leave-types/?is_active=true"))
earned = next(t for t in types["results"] if t["code"] == "EL")
start = date.today() + timedelta(days=21)
while start.weekday() != 0:
    start += timedelta(days=1)

applied = joiner.post(
    "/api/v1/leaves/",
    {
        "leave_type": earned["id"],
        "start_date": start.isoformat(),
        "end_date": start.isoformat(),
        "reason": "Walkthrough: first request.",
    },
    content_type="application/json",
)
check(
    "a new joiner can apply for leave straight away",
    applied.status_code == 201,
    str(data(applied))[:160],
)
note("their manager is unset, so it goes to HR - logged as a warning, not an error")

# ---------------------------------------------------------------------------
scenario("Locked out: the forgotten-password flow")
# ---------------------------------------------------------------------------
mail.outbox.clear()
asked = anon.post(
    "/api/v1/auth/password/forgot/", {"email": NEW_EMAIL}, content_type="application/json"
)
check("asking for a reset answers 204", asked.status_code == 204, str(asked.status_code))
check("an email goes out", len(mail.outbox) == 1, str(len(mail.outbox)))

unknown = anon.post(
    "/api/v1/auth/password/forgot/",
    {"email": "nobody@trigyan.io"},
    content_type="application/json",
)
check(
    "an unknown address answers identically",
    unknown.status_code == 204 and not unknown.content,
    str(unknown.status_code),
)
check("and nothing is sent to it", len(mail.outbox) == 1, str(len(mail.outbox)))

temporary = temporary_from_email()
check("the old password stops working at once", login(NEW_EMAIL, "Chosen@2026").status_code == 400)

with_temp = login(NEW_EMAIL, temporary)
check(
    "the temporary password gets them in", with_temp.status_code == 200, str(with_temp.status_code)
)
check("and forces a change again", data(with_temp)["user"]["must_change_password"] is True)

reused = login(NEW_EMAIL, temporary)
check("it cannot be used twice", reused.status_code == 400, str(reused.status_code))
check(
    "and the refusal explains why",
    "already been used" in data(reused).get("error", {}).get("message", ""),
    str(data(reused).get("error", {}).get("message")),
)

check(
    "the old session was retired by the reset",
    joiner.get("/api/v1/auth/me/").status_code == 401,
    str(joiner.get("/api/v1/auth/me/").status_code),
)

# Nothing sensitive is left lying about.
from apps.authentication.models import PasswordResetToken  # noqa: E402

token = PasswordResetToken.objects.filter(user__email=NEW_EMAIL).latest("created_at")
check(
    "only the hash of the temporary password is stored",
    token.token_hash != temporary and len(token.token_hash) > 40,
    token.token_hash[:24],
)
check("it is marked used", token.used_at is not None, str(token.used_at))
check("the email carried no clickable link", "http" not in mail.outbox[-1].body)

raise SystemExit(summarise())
