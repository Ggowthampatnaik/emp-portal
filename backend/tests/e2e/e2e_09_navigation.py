"""End-to-end: does the sidebar each role sees match what the API lets them do?

A nav entry that leads to a 403 is a broken promise; a module somebody needs
that never appears is worse. This reads the SPA's own navigation definition and
checks it against each role's real permissions and real API responses.
"""

import pathlib
import re

from e2e_harness import Persona, check, data, note, scenario, summarise

#: The SPA's own navigation definition, read as data so this walkthrough tests
#: what the sidebar actually offers rather than a copy of it that could drift.
NAV_FILE = (
    pathlib.Path(__file__).resolve().parents[3] / "frontend/src/components/layout/navigation.ts"
)

# What each sidebar entry actually loads, so "visible" can be tested as "works".
LANDING = {
    "/": "/api/v1/dashboard/summary/",
    "/employees": "/api/v1/employees/directory/",
    "/projects": "/api/v1/projects/",
    "/leave": "/api/v1/leave-balances/me/",
    "/holidays": "/api/v1/holidays/",
    "/timesheets": "/api/v1/timesheets/me/",
    "/payroll": "/api/v1/payslips/periods/",
    "/finance": "/api/v1/finance/approvals/",
    "/reports": "/api/v1/reports/leave/",
    "/administration": "/api/v1/admin/users/",
}

PERSONAS = [
    ("Employee", "asha.rao@trigyan.io"),
    ("Manager", "vikram.nair@trigyan.io"),
    ("HR", "priya.menon@trigyan.io"),
    ("Admin", "rahul.iyer@trigyan.io"),
    ("Finance", "fatima.sheikh@trigyan.io"),
    ("Super Admin", "sneha.kulkarni@trigyan.io"),
]


def parse_navigation():
    """Reads label / path / permissions out of the SPA's navigation.ts."""
    source = NAV_FILE.read_text(encoding="utf-8")
    body = source[source.index("export const NAV_ITEMS") :]
    items = []
    for block in re.findall(r"\{(.*?)\},\n", body, flags=re.S):
        label = re.search(r"label:\s*'([^']+)'", block)
        path = re.search(r"path:\s*'([^']+)'", block)
        perms = re.search(r"permissions:\s*\[([^\]]*)\]", block, flags=re.S)
        if label and path:
            codes = re.findall(r"'([^']+)'", perms.group(1)) if perms else []
            items.append((label.group(1), path.group(1), codes))
    return items


scenario("The sidebar is read from the SPA's own definition")
NAV = parse_navigation()
check("navigation.ts parsed", len(NAV) >= 9, str(len(NAV)))
note(", ".join(label for label, _, _ in NAV))

for role, email in PERSONAS:
    scenario(f"{role}: sidebar vs what the API allows")
    person = Persona(email, role)
    identity = data(person.get("/api/v1/auth/me/"))
    held = set(identity.get("permissions", []))
    is_super = "super_admin" in identity.get("roles", [])

    visible, hidden = [], []
    for label, path, codes in NAV:
        shown = is_super or not codes or bool(held & set(codes))
        (visible if shown else hidden).append((label, path))

    note(f"sees: {', '.join(name for name, _ in visible)}")

    for label, path in visible:
        endpoint = LANDING.get(path)
        if not endpoint:
            continue
        response = person.get(endpoint)
        check(
            f"{role}: '{label}' is shown and opens",
            response.status_code == 200,
            f"{endpoint} -> {response.status_code}",
        )

    for label, path in hidden:
        endpoint = LANDING.get(path)
        if not endpoint:
            continue
        response = person.get(endpoint)
        check(
            f"{role}: '{label}' is hidden and refused",
            response.status_code == 403,
            f"{endpoint} -> {response.status_code}",
        )

# ---------------------------------------------------------------------------
scenario("Every role can do the thing its landing page is for")
# ---------------------------------------------------------------------------
expectations = {
    "Employee": ["/", "/employees", "/leave", "/holidays", "/timesheets", "/payroll"],
    "Manager": ["/", "/employees", "/projects", "/leave", "/timesheets", "/payroll", "/reports"],
    "HR": ["/", "/employees", "/leave", "/timesheets", "/payroll", "/reports"],
    "Admin": ["/", "/employees", "/projects", "/leave", "/payroll", "/reports", "/administration"],
    "Finance": ["/", "/employees", "/holidays", "/payroll", "/finance"],
    "Super Admin": [path for _, path, _ in NAV],
}
for role, email in PERSONAS:
    person = Persona(email, role)
    identity = data(person.get("/api/v1/auth/me/"))
    held = set(identity.get("permissions", []))
    is_super = "super_admin" in identity.get("roles", [])
    shown = {path for _, path, codes in NAV if is_super or not codes or (held & set(codes))}

    wanted = set(expectations[role])
    missing = wanted - shown
    check(f"{role} is offered everything the role needs", not missing, str(sorted(missing)))

raise SystemExit(summarise())
