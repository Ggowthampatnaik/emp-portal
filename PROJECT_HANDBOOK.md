# Trigyan Employee Management Portal — Project Handbook

**Status:** demo-ready, running locally under an always-on watchdog. Not deployed;
hosting requirements have been drafted for the company admin.
**Last updated:** 27 August 2026

This document is the single source of truth for the project. It is written so that
someone — or some agent — with **no prior context** can read it once and be
productive: what the system is for, how it is built, what is finished, what is
not, and where the traps are.

---

## 1. Objective

An internal web portal for **Trigyan** to manage its people and their work:

- who works here, in what department, reporting to whom
- what projects exist and who is allocated to them
- leave: policies, balances, applications, approvals
- timesheets: weekly time booking, submission, approval
- payroll: salary structures, monthly runs, payslips
- reporting over all of the above, and an audit trail of every change

It is built from an architecture diagram supplied by the client (reproduced in
substance in §3). Two things have been added beyond that diagram at the client's
request: a **Payroll** module and a **company directory**. One thing in the
diagram has been deliberately supplemented: sign-in is Microsoft Entra ID SSO in
the diagram, and the portal still supports that, but **email + password login was
added** because it was explicitly requested and because SSO cannot be tested
without tenant app registrations that do not yet exist.

### Who uses it

Six roles. Super Admin sits above the rest; HR, Manager, Admin and Finance are
peers; Employee is the base role **every new joiner starts with**.

| Role | Typical work |
| --- | --- |
| **Employee** | Own profile, apply for leave, submit timesheets, view own payslips, browse the directory |
| **Manager** | Everything an employee does, plus approving leave and timesheets for their reporting branch, and managing project teams and allocations |
| **HR** | Org-wide employee records, leave policy and holidays, salary structures, processing payroll, org reports |
| **Admin** | User accounts and company assets (Administration is deliberately just those two tabs now), roles via the Employees table, project portfolio, **approving payroll** |
| **Finance** | Releasing approved payslips to employees, raising queries back to HR |
| **Super Admin** | Passes every permission check, but the module itself is deliberately trimmed to people governance: an Employees list with an inline role dropdown, and nothing else — no dashboard, org chart, directory tab or add-employee |

---

## 2. Running it (the fast path)

The project lives at `c:\Users\durga\OneDrive\Desktop\emp portal`.

### One command

```powershell
powershell -ExecutionPolicy Bypass -File tools\start-portal.ps1        # demo bundle on :4173
powershell -ExecutionPolicy Bypass -File tools\start-portal.ps1 -Dev   # Vite dev server on :5173
```

A Windows scheduled task (**`Trigyan Employee Portal`**, installed by
`tools/install-autostart.ps1`) re-runs the launcher at logon and every minute,
health-checking with real HTTP requests — so the portal survives reboots,
crashes and wedged processes without anyone touching it. A small helper also
answers on **port 80 and whichever of 5173/4173 is not in use** and redirects to
the live port, so any address someone remembers works.

### Two terminals (manual, if you prefer)

```bash
# Terminal 1 — API on :8000
cd backend
.venv/Scripts/python.exe manage.py runserver 8000

# Terminal 2 — SPA on :5173
cd frontend
npm run dev
```

Open **http://localhost:4173** (demo) or **http://localhost:5173** (dev).

Other useful URLs:

| URL | What |
| --- | --- |
| `http://localhost:4173` | The portal (built bundle — what the watchdog serves) |
| `http://localhost:5173` | The portal (Vite dev server, when started with `-Dev`) |
| `http://localhost:8000/api/docs/` | Swagger UI |
| `http://localhost:8000/api/schema/` | OpenAPI schema |
| `http://localhost:8000/healthz/` | Health probe (DB + cache) |
| `http://localhost:8000/django-admin/` | Django maintenance admin (needs `createsuperuser`) |

### Demo accounts

All use the password **`Portal@123`**. Created by `manage.py seed_demo_data`.

| Email | Role | Good for exercising |
| --- | --- | --- |
| `asha.rao@trigyan.io` | Employee | Own leave/timesheet/payslip, directory |
| `vikram.nair@trigyan.io` | Manager | Approval queues, team scoping (3 direct reports) |
| `priya.menon@trigyan.io` | HR | Full directory, leave policy, salary structures, processing payroll |
| `rahul.iyer@trigyan.io` | Admin | Administration (Users + Assets), onboarding new joiners, deleting accounts, role changes from the Employees table, **approving payroll** |
| `fatima.sheikh@trigyan.io` | Finance | The Finance module: releasing payslips, raising queries |
| `sneha.kulkarni@trigyan.io` | Super Admin | Everything |

### Rebuilding the database from scratch

```bash
cd backend
rm -f db.sqlite3
.venv/Scripts/python.exe manage.py migrate
.venv/Scripts/python.exe manage.py seed_rbac        # 6 roles, 49 permission codes
.venv/Scripts/python.exe manage.py seed_skills      # the starter skill vocabulary
.venv/Scripts/python.exe manage.py seed_demo_data   # the demo organisation
```

`seed_demo_data` is idempotent and refuses to run unless `DEBUG` is on. It
currently produces: 14 employees — every one with a gender and a generated
initials avatar — 5 departments, 12 designations, 5 projects with teams and
allocations, 5 leave types, holidays for **this year and next** (7 each, all
with descriptions), 10 leave requests across every workflow state, 18
timesheets, 14 salary structures, payroll runs, 14 bank accounts, 11 company
assets (a third of staff deliberately have none), 21 real-PDF profile
documents, 56 employee skills, and a handful of payslips sent to Finance (one
already released). Run `seed_skills` before it, or the skills step finds an
empty vocabulary and says so.

The company email domain is **`@trigyan.io`** throughout — code, seeds and the
live database were migrated from `.com` on 26 August.

---

## 3. Architecture and stack

Three tiers, exactly as the client's diagram specifies.

```
React SPA (Vite, TypeScript, Redux Toolkit, MUI)
        │  HTTPS / REST, JWT bearer
        ▼
Django + Django REST Framework  ──►  PostgreSQL
        │                        ──►  Redis (cache + Celery broker)
        │                        ──►  Azure Blob Storage (documents, photos)
        ▼
Celery worker + beat (emails, notifications, scheduled jobs)
```

| Layer | Technology | Version pinned |
| --- | --- | --- |
| Frontend | React + TypeScript | React 18.3, TS 5.7 |
| UI library | **MUI** (the diagram said "MUI / Ant Design"; MUI was chosen) | 6.4 |
| State | Redux Toolkit | 2.5 |
| Build | Vite | 6.0 |
| API | Django REST Framework | ≥3.16 |
| Backend | Python + Django | Django 6.0, Python 3.12+ (3.14 locally) |
| Database | PostgreSQL (SQLite fallback locally — see §12) | psycopg 3.2 |
| Cache / queue | Redis | ≥6.0 |
| Jobs | Celery (+ beat, django-celery-results) | ≥5.5 |
| Auth | Microsoft Entra ID SSO **and** local password | SimpleJWT 5.5 |
| Files | Azure Blob Storage via django-storages; Pillow for images | Pillow ≥11.1 |
| Docs | drf-spectacular (OpenAPI 3) | ≥0.28 |
| Deploy | Docker → Azure Container Apps behind Front Door / App Gateway | **not yet done** |
| Monitoring | Azure Application Insights (OpenTelemetry) | configured, unused locally |

Code size: 146 backend Python files, 74 frontend source files.

---

## 4. Repository layout

```
emp portal/
├── PROJECT_HANDBOOK.md          ← this file
├── README.md                    quick start and conventions
├── docker-compose.yml           postgres, redis, api, celery worker, beat, spa
├── .github/workflows/ci.yml     lint, typecheck, test, build, docker build
├── docs/
│   ├── DEVELOPMENT_PLAN.md      original phase plan (historical)
│   └── openapi.yaml             generated API schema
├── tools/
│   └── make_login_background.py regenerates the login GIF from brand colours
├── backend/
│   ├── config/
│   │   ├── settings/            base.py, dev.py, test.py, staging.py, prod.py
│   │   ├── urls.py              route table + JSON 404/500 handlers
│   │   ├── celery.py, wsgi.py, asgi.py
│   ├── apps/
│   │   ├── authentication/      User, Role, ModulePermission, UserRole
│   │   ├── employees/           Department, Designation, Employee, EmployeeDocument
│   │   ├── projects/            Project, ProjectMember, ProjectAllocation
│   │   ├── leave_management/    LeaveType, Holiday, LeaveBalance, LeaveRequest, LeaveApproval
│   │   ├── timesheets/          Timesheet, TimesheetEntry, TimesheetApproval
│   │   ├── payroll/             SalaryStructure, PayrollRun, Payslip
│   │   ├── notifications/       Notification (+ Celery tasks)
│   │   ├── reports/             no models — aggregates, dashboard, upcoming.py
│   │   └── administration/      AuditLog, SystemSetting
│   ├── common/                  the shared spine — see §5
│   ├── requirements/            base.txt, dev.txt, prod.txt
│   ├── conftest.py              pytest fixtures (the `org` fixture matters)
│   └── manage.py
└── frontend/
    ├── public/                  favicon.svg, login-background.gif/.png
    └── src/
        ├── app/                 store, router, providers, typed hooks
        ├── features/            auth, dashboard, employees, projects, leave,
        │                        timesheet, payroll, reports, admin, notifications, ui
        ├── components/          common (Feedback, Logo, StatusChip, PageHeader), layout
        ├── services/            api/ (client, endpoints, services), auth/ (MSAL, tokens)
        ├── hooks/               useApiResource, usePermissions
        ├── types/               api.ts, auth.ts, domain.ts
        ├── utils/               date.ts, format.ts
        └── styles/              theme.ts (BRAND colours live here)
```

---

## 5. The shared spine (`backend/common/`)

Read this before touching any module. Almost every cross-cutting rule lives here.

| File | What it does |
| --- | --- |
| `enums.py` | `RoleSlug`, `ApprovalStatus`, `EmploymentStatus`, `AuditAction`. The frontend mirrors these in `types/`. |
| `permissions.py` | `HasModulePermission` — views declare `required_permissions`; also role classes (`IsHR`, `IsManager`, …) |
| `scoping.py` | **Row-level visibility.** `visible_employee_ids`, `scope_by_employee`, `approvable_employee_ids`. One rule, used everywhere. |
| `exceptions.py` | The single error envelope + `BusinessRuleViolation` (409) and `WorkflowStateError` |
| `pagination.py` | `?page=&page_size=` with `count`/`total_pages`/`results` |
| `middleware.py` | `X-Request-ID` in, correlated, echoed out |
| `audit.py` | `record_audit(...)` — never raises, always logs |
| `models.py` | Abstract bases: `TimeStampedModel`, `UUIDModel`, `AuditableModel`, `SoftDeleteModel` |
| `utils.py` | `working_days()`, `week_bounds()`, decimal helpers |

### The visibility rule (memorise this)

```
HR / Admin / Super Admin  →  the whole organisation
Manager                   →  themselves plus their entire reporting branch (not just direct reports)
Employee                  →  only their own records
```

Approvers are the same set **minus themselves** — nobody approves their own
request. That is `approvable_employee_ids()`.

---

## 6. Domain model, module by module

### 6.1 Authentication (`apps/authentication`)

- **User** — email is the username. No company password is required for SSO users
  (`set_unusable_password`). Fields worth knowing: `entra_object_id`, `entra_upn`,
  `must_change_password`, `last_login_at`. Cached helpers: `role_slugs`,
  `is_privileged`, `is_super_admin`, `has_module_permission(code)`.
- **Role** — 6 system roles, each a bundle of permissions. **Finance** was
  added in Phase 5 and is the narrowest: beyond its own module it holds only
  the self-service every employee has. It sees *other people's* pay, because
  that is what it releases, and nobody else's employee record, leave or
  timesheets.
- **ModulePermission** — 39 fine-grained codes like `leave.approve`.
- **UserRole** — the join, recording who granted the role.

Two ways in, both ending in the same portal JWT pair:

1. `POST /auth/login/` with `{email, password}`.
2. `POST /auth/entra/exchange/` with an Entra ID access token as a Bearer header —
   validated against tenant JWKS, user provisioned just-in-time.

`/auth/token/refresh/` rotates the pair. The axios interceptor refreshes once on a
401 and replays the original request.

### 6.2 Employees

- **Department** (code, name, head), **Designation** (code, name, level)
- **Employee** — the employment record behind a user: `employee_code` (shown in the
  UI as **Employee ID**), department, designation, `reporting_manager` (self-FK),
  `date_of_joining`, `employment_status`, phone, `date_of_birth`, gender,
  `blood_group`, `permanent_address`, `current_address`, emergency contact,
  `work_location`, `photo`.
  `descendant_ids()` walks the whole reporting subtree — that is what makes manager
  scoping work.
- **EmployeeDocument** — files attached to a record.

Deletion is **deactivation**: `employment_status → inactive` and the user is
disabled. History must survive.

**Self-service limits:** an employee may edit only `phone`, `date_of_birth`,
`gender`, `blood_group`, `permanent_address`, `current_address`, emergency contact.
Anything else needs `employee.edit`. Enforced server-side in
`EmployeeViewSet.update`.

### 6.3 Projects

- **Project** — code, name, client, department, project manager, status
  (planned/active/on_hold/completed/cancelled), dates, billable flag.
- **ProjectMember** — who is on the team and in what role.
- **ProjectAllocation** — percentage of capacity. **An employee may not exceed 100%
  across all active allocations**, and **timesheet hours may only be booked to a
  project the employee is allocated to.**

Projects are cancelled, never deleted — timesheet entries reference them.

**HR reads the whole portfolio.** `project.view_all` is a read grant, and HR
holds it because "who is on what" is an HR question. Without it the Projects
page was empty for them: HR sits on no project team, so the scoped query
returned nothing at all. Staffing and allocation stay with the reporting
manager — HR gets the list and the expanded team, and none of the controls.

**One screen, not two.** A project opens in place under its own row on the
projects list; there is no separate detail page, and no `/projects/:id` route.
The expanded panel carries what that page owned — the team, each person's
allocation, and the controls to change both, gated on `project.assign_team` and
`project.allocate`. Removing the page without moving those would have left the
API able to staff a project and the UI unable to. The panel fetches
`projects/{id}/` once rather than members and allocations separately, so the two
lists cannot disagree halfway through a change.

Role labels live in `features/projects/roles.ts` and mirror
`ProjectMember.ProjectRole`. They were previously declared twice and had
drifted: the team table labelled `tester` and `support`, which the API does not
accept, while showing the values it does accept — `manager`, `qa`, `devops` —
as raw slugs.

### 6.4 Leave

- **LeaveType** — days per year, paid/unpaid, max consecutive days, half-day
  allowed, carry-forward.
- **Holiday** — mandatory holidays are skipped when counting leave days; optional
  ("floating") ones still consume leave.
- **LeaveBalance** — per employee, per type, per year:
  `entitled = allocated + carried_forward`, `available = entitled − used − pending`.
- **LeaveRequest** / **LeaveApproval** — the request and every decision on it.
- **LeaveRequestCC** — people copied in on a request, with `notified_at` so
  "were they actually told?" is answerable. Being copied in is **information,
  not access**: it grants no visibility of the request and no say in it.

**Leave is approved twice** (decisions D1 and D2), which is the single most
important rule in this module:

```
apply -> pending_manager -> [manager approves] -> pending_hr -> [HR approves] -> approved
                          \-> [manager rejects] -> rejected
                                                 \-> [HR sends back] -> pending_manager
```

- `status` is the overall state (`LeaveStatus`); `manager_status` and
  `hr_status` (`LeaveStageStatus`) carry each stage's verdict, actor, timestamp
  and comment.
- **The balance is debited on HR approval only (D1).** Days sit in
  `pending_days` for the whole of stage one. A manager approving moves the
  request forward and spends nothing.
- **Only the manager stage can reject (D2).** HR's disagreement is a *send
  back* with a mandatory comment, which returns the request to
  `pending_manager` and resets `manager_status` — so the earlier approval does
  not stand. The days stay reserved throughout.
- **HR never rejects leave, at either stage.** `/reject/` refuses anyone
  holding `leave.view_all` outright, with a message pointing at send-back — it
  is a rule on the server, not a hidden button. The reporting manager owns the
  conversation with the employee, so a request HR is unhappy with goes back to
  them rather than dying in HR's queue. Correspondingly, the **Manager
  approvals** tab is not shown to HR at all: HR works stage two only.
- Stage two needs `leave.view_all` as well as `leave.approve`, so a manager
  cannot take a request from applied to approved on their own.
- One consequence to watch: if an HR user is also somebody's reporting manager,
  that person's stage-one requests have no approver in HR's own screens. Either
  point the reporting line elsewhere or have a Super Admin act.

### 6.5 Timesheets

- **Timesheet** — one employee, one week (always Monday-start).
- **TimesheetEntry** — hours against one project on one day.
- **TimesheetApproval** — decision history.

Rules: work date must fall inside the sheet's week; ≤24 hours per day; project must
be allocated; approved sheets are immutable; **every entry needs a task
description before the sheet can be submitted** (the refusal names the first
offending entry and the total missing).

HR tracking (`timesheet.view_all`) answers "who has not filed?" for a week —
`status/by-project/` and `status/by-employee/`, both defaulting to the **last
completed** Monday–Sunday week. `notify/` (`timesheet.notify`, HR + Super Admin)
raises one notification per non-submitter and silently skips anyone who has
already submitted, so a whole project's team can be passed in unfiltered.

### 6.1b Getting in, and getting back in (Phase 7 of the new-features plan)

**Forgotten password (F17, decision D8).** `POST /auth/password/forgot/` takes
an address and **always** answers 204 — telling a stranger whether an account
exists hands them half a credential-stuffing list. If it matches an active
account, a temporary password is emailed. Only its **hash** is stored
(`PasswordResetToken`), it **expires after 30 minutes**, and it works **once**:
signing in with it spends it. The old password stops working immediately, and
every session the account already had is retired — see the token version below.
The signed reset link stays on the backlog (B1); swapping it in means changing
`deliver_reset_email` and nothing else.

**Token version.** There is no token blacklist in this deployment, so each JWT
carries the account's `token_version` and `PortalJWTAuthentication` compares it
on every request. Bumping `User.token_version` retires every token minted before
that moment. It is bumped when a credential is replaced by *somebody else* — a
forgotten-password reset, or an administrator issuing a temporary password — and
deliberately **not** when you change your own password, because that should not
sign you out of the tab you are typing in.

**First login (F18, decision D11).** There is no self-signup. HR creates the
account and hands over temporary credentials; then:

1. sign in with them,
2. `must_change_password` forces a new password,
3. the **Complete Profile** wizard collects `MANDATORY_PROFILE_FIELDS`,
4. `Employee.profile_completed` flips and the portal opens.

**The gate is hard.** It lives in `common/profile_gate.py` and is enforced from
the *authentication* class, not a DRF permission — almost every viewset here
declares its own `permission_classes`, and a declared list replaces the default,
so a default permission would apply to almost nothing. Until the profile is
complete the credential opens the wizard's own endpoints and nothing else;
typing a URL gets a 403, not a page. The migration grandfathers everyone who was
already on the system, so upgrading does not lock out the company.

Afterwards, on My Profile: **ExperienceDetail** (previous jobs) and the itemised
education document types — `tenth`, `intermediate`, `bachelors`, `masters`,
`other_education`, `experience_letter`.

### 6.2b Account closure (Module 6 of the new-features plan)

- **AccountDeletionRequest** — employee, requester, reason, status, decider,
  decision note. HR raises it (`employee.request_deletion`); an administrator
  decides (`employee.approve_deletion`). A partial unique constraint allows
  only one open request per employee.
- **"Deletion" never deletes.** Approving sets `employment_status = inactive`
  and `user.is_active = False`, which is the deactivation path that already
  existed. No row is removed: leave, timesheets and payslips are records the
  company still needs, and payroll records are a statutory obligation. The
  account can be reactivated from Administration → Users.
- **Maker-checker**, as in payroll: whoever raised the request cannot decide on
  it. The permission split covers HR, and an explicit check in
  `apps/employees/services.py` covers a Super Admin, who holds both.
- Sign-in for a closed account fails with the same 400 as an unknown address,
  so a closed account cannot be told apart from one that never existed.

### 6.4a The dashboard noticeboard

Two cards, and they are a matched pair by construction rather than by luck:

- **Same window.** Both are scoped on the server to what is left of *this
  calendar month* — `upcoming_birthdays(current_month_only=True)` and
  `upcoming_holidays(current_month_only=True)`. A rolling 30-day horizon used
  to spill into next month, so on 25 August the birthday card listed September
  under a heading about what was coming up.
- **Same cap.** `DASHBOARD_BIRTHDAY_LIMIT == DASHBOARD_HOLIDAY_LIMIT`. A
  four-row card beside an eight-row one is the misalignment people notice.
- **Same frame.** Both render through `components/common/SectionCard`, which
  fills its grid cell (`height: 100%`) and pins the footer to the bottom, so a
  row of cards is one height and the "View more" links sit on one line. The
  grid must not set `alignItems: 'start'` — start-aligned cells size to their
  own content and quietly undo it. There is a test for exactly that.

`horizon_days` is still echoed in the summary response, but it no longer bounds
the noticeboard.

`SectionCard` is also the frame for every card on the profile page, which is
what gives the two screens one rhythm: same 24px inset, same header row, same
rule offset, same stretch.

### 6.5 Adding an account

Two doors, one result. **Employee onboarding** (`POST /employees/`) raises an
account *and* an employment record together. **Administration → Users → Add
user** (`POST /admin/users/`, `admin.manage_users`) raises a bare account for
somebody who needs to sign in without being on the payroll — a contractor, an
auditor, a joiner whose paperwork has not caught up.

Both go through `User.objects.create_user`, so the password is hashed the same
way, and both set `must_change_password`, so the first sign-in lands on the
change-password screen identically. There is no second and weaker way in.

The temporary password is held to the same validators as any other password: it
is a real credential for as long as it lasts. Roles are **not** set at creation
— the Users tab already has one control for that, and two ways to grant access
is how the two drift apart. Until a role is assigned the account is inert:
scoped lists come back empty and anything behind a permission refuses.

An account with no employment record is not held at the Complete Profile gate —
there is no profile for it to complete (see `common/profile_gate.py`).

### 6.5a New employee registration

There is no self-service sign-up: employment is what grants access, so HR
creates the account. **New employee registration** on the sign-in page is the
door for the person holding the temporary password, and it *activates* an
account that already exists rather than opening a new one. It validates through
the same `/auth/login/` endpoint as the sign-in form, so there is no second and
weaker path into an account.

The journey, in order:

1. `/register` — username and temporary password. Validated by signing in.
2. `/change-password` — the temporary password travels there in router state so
   a one-time credential is typed once, not twice. Only the new password and its
   confirmation are asked for.
3. **Signed out.** `PasswordChangeSerializer` bumps `token_version`, so every
   token for the account dies, the one that made the change included. That is
   enforced on the server: the SPA only performs the tidy version of it, so the
   next request does not report a session expiry over the top of a change that
   worked.
4. `/login` again with the new password.
5. `/complete-profile` — the mandatory fields (see `MANDATORY_PROFILE_FIELDS`),
   behind the hard gate in `common/profile_gate.py`. Submitting sets
   `profile_completed`, and the rest of the portal opens.

Everything after that is optional and lives on the profile page: skills (from
the controlled vocabulary), previous employment, and documents — 10th, 12th,
bachelor's, master's, other education, experience letters and anything else. The
employee owns that section: they attach and remove their own, and HR/Admin can
do the same on anyone's record with `employee.edit`.

### 6.5b Bank details and skills (added in Phase 4 of the new-features plan)

- **BankAccount** — one per employee: holder, bank, branch, account number,
  IFSC, type. Per **decision D9** it is readable and writable by the employee
  and by HR (`bank.manage`) only — **never the reporting manager**, who can see
  the rest of the record. The full account number is returned solely to the
  owner; everyone else, HR included, gets `account_number_masked`
  (`XXXXXXXXXX7788`). The audit log records the masked form only.
- **EmployeeAsset** — company kit issued to a person: name, brand, serial
  number and an optional photo, many per employee. The serial number is
  **unique across the company** and stored upper-case: the same physical device
  cannot be out with two people, so a clash is nearly always the same item
  recorded twice. Reissuing is an edit of the row, not a second one. Reading
  follows the visibility of the employee record itself — you see your own kit,
  a manager sees their team's — while issuing, amending and taking back need
  `asset.manage` (HR and Admin), because handing over hardware is a custody
  decision rather than a profile edit. A clash names the current holder rather
  than saying "must be unique", which would send HR hunting through the
  company; only `asset.manage` reaches that message, and it can already see
  that record.
  Two ways in, one behaviour: the assets card on a profile answers "what does
  *this* person hold", and **Administration → Assets** answers "who holds what"
  across the company. That page lists every employee — including the ones
  holding nothing, which is the more useful half of a register — with a count
  annotated onto the employee list itself, and fetches the assets only when a
  row is expanded. Both routes share `AssetDialog` and the same endpoints, so
  they cannot drift. The tab shows for `asset.manage`, which in practice means
  Admin and Super Admin: HR holds the permission too but reaches assets through
  each profile, because widening the Administration guard would put a one-tab
  "Administration" entry in HR's sidebar.
- **EmployeeDocument** — certificates and letters on a profile, all optional
  and none of them gating anything. The employee owns the section: they attach
  and remove their own, and HR/Admin can do the same on anyone's record with
  `employee.edit`. Categories: 10th, 12th, bachelor's, master's, **skills
  certification**, other educational, experience, ID proof, address proof,
  contract, other.

  **PDF only, checked on the bytes.** The `accept` attribute and the filename
  are courtesies — a caller posting straight at the API picks both — so the
  serializer reads the first five bytes and requires `%PDF-`, then rewinds the
  file so it still saves whole. There is a test for that rewind, because
  consuming the stream to validate it is the obvious way to break the feature
  while every other test still passes. Capped at 10 MB.
- **Skill** — a controlled vocabulary (**D10**), seeded by
  `manage.py seed_skills` and extendable by HR. Deleting retires
  (`is_active=False`) rather than removing, so existing profiles keep their
  history.
- **EmployeeSkill** — one claim: skill, proficiency, years. The whole set is
  saved in one PUT, which makes add, edit and remove a single operation.
- `?skills=1,2` on the employee list *and* the directory keeps only people who
  hold **every** listed skill — staffing asks "who knows React *and* Postgres",
  so the terms narrow rather than widen.

### 6.6 Payroll (added beyond the original architecture)

- **SalaryStructure** — effective-dated monthly components. Earnings (basic, HRA,
  conveyance, medical, special) and deductions (PF, professional tax, income tax,
  other). A raise is a **new row**, not an edit; creating one automatically closes
  the previous one the day before.
- **PayrollRun** — one month: draft → processed → approved → paid.
- **Payslip** — one employee, one run. **Every amount is a snapshot** written at
  processing time, so a later raise can never rewrite a paid month.

### 6.6b Finance (Module added in Phase 5 of the new-features plan)

Payroll works out **what** people are paid. Finance decides **when it goes
out**. Its own app (`apps/finance`), its own role, its own table — so Payroll
never has to know how Finance works, and the release history is auditable on
its own.

- **PayslipApproval** — one row per payslip: `pending` → `processed` (HR pushed
  it) → `approved` (Finance released it), with `queried` as the send-back
  state. Finance has **no reject**; a payslip it disagrees with goes back to HR
  with a comment, the same reasoning as HR's leave send-back (D2).
- **Two approvals now sit on the same money, and they are different things:**
  an administrator approves the **run** ("is the month's calculation right?"),
  then HR pushes each **payslip** and Finance releases it ("should this go out
  now?"). Both the Finance page and the payroll tab label their stage, because
  an unlabelled queue is how somebody releases pay thinking they are checking
  arithmetic.
- A payslip cannot reach Finance until its run is approved, and whoever pushed
  it cannot be the one who releases it.
- Nothing in Finance changes an amount.

**Payslip PDFs** (`apps/payroll/pdf.py`) are ReportLab — pure Python, so
neither the Windows dev setup nor the container build needs Cairo and Pango.
Every figure comes off the `Payslip` snapshot, so re-downloading last year's
payslip always yields last year's numbers. Filename:
`EmployeeName_Year_Month.pdf`. `apps/payroll/amounts.py` writes the net pay out
in words using the **Indian** scale — lakh and crore, not "hundred thousand".

### 6.7 Notifications, Reports, Administration

- **Notification** — in-app, with email delivered via Celery. `notify()` in
  `apps/notifications/services.py` is the only entry point.
- **Reports** — no models. Four aggregate reports plus the dashboard summary and
  `upcoming.py` (birthdays and holidays).
- **AuditLog** — append-only. **SystemSetting** — runtime configuration.

---

## 7. Roles and permissions

49 codes. `super_admin` bypasses every check in `has_module_permission`.

| Permission | super | admin | hr | manager | employee |
| --- | :-: | :-: | :-: | :-: | :-: |
| `employee.view_self` / `employee.edit_self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `employee.view_team` | ✓ | | | ✓ | |
| `employee.view_all` | ✓ | ✓ | ✓ | | |
| `employee.create` / `employee.deactivate` | ✓ | | ✓ | | |
| `employee.edit` | ✓ | ✓ | ✓ | | |
| `department.manage` | ✓ | ✓ | ✓ | | |
| `employee.request_deletion` | ✓ | | ✓ | | |
| `employee.approve_deletion` | ✓ | ✓ | | | |
| `bank.view_self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `bank.manage` / `skill.manage` | ✓ | | ✓ | | |
| `asset.manage` | ✓ | ✓ | ✓ | | |
| `project.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.view_all` | ✓ | ✓ | ✓ | ✓ | |
| `project.manage` | ✓ | ✓ | | | |
| `project.assign_team` / `project.allocate` | ✓ | | | ✓ | |
| `leave.apply` / `leave.view_self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `leave.view_team` | ✓ | | | ✓ | |
| `leave.view_all` | ✓ | ✓ | ✓ | | |
| `leave.approve` | ✓ | | ✓ | ✓ | |
| *stage two* — `leave.approve` **and** `leave.view_all` | ✓ | | ✓ | | |
| `leave.cancel_any` / `leave.manage_policy` | ✓ | | ✓ | | |
| `timesheet.submit` / `timesheet.view_self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `timesheet.view_team` / `timesheet.approve` | ✓ | | | ✓ | |
| `timesheet.view_all` | ✓ | ✓ | ✓ | | |
| `timesheet.notify` | ✓ | | ✓ | | |
| `payroll.view_self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payroll.view_all` | ✓ | ✓ | ✓ | | |
| `payroll.manage` / `payroll.process` | ✓ | | ✓ | | |
| `payroll.approve` | ✓ | ✓ | | | |
| `payroll.push_to_finance` | ✓ | | ✓ | | |
| `finance.view` / `finance.approve` | ✓ | | | | |
| `report.employee` | ✓ | ✓ | ✓ | | |
| `report.leave` / `report.timesheet` / `report.export` | ✓ | ✓ | ✓ | ✓ | |
| `report.project` | ✓ | ✓ | | ✓ | |
| `admin.manage_users` / `manage_roles` / `system_config` / `view_audit_log` | ✓ | ✓ | | | |

The matrix omits the `finance` role for width: it carries the employee
baseline plus `finance.view` and `finance.approve`.

Totals: super_admin 49, hr 33, admin 29, manager 21, finance 12, employee 9.

**Authorisation is enforced on the backend for every request.** The frontend uses
the same codes only to decide what to render — never as the security boundary.

Two rules sit above the permission codes, both born of real incidents:

- **Nobody can change their own roles** — a Super Admin once unticked their own
  role in the table and demoted themselves mid-session. Somebody else holds the pen.
- **Nobody can delete their own account** — bulk deletion skips the caller, so
  "delete all" can never lock every administrator out in one click.

---

## 8. API

115 paths, all under `/api/v1/`. Full list in `docs/openapi.yaml` or Swagger.

### Conventions

- **Auth:** `Authorization: Bearer <portal JWT>`
- **Pagination:** `?page=2&page_size=50` → `{count, page, page_size, total_pages, next, previous, results}`
- **Filtering / search / ordering:** django-filter + DRF backends
- **Report CSV export:** `?export=csv` — **not** `?format=csv`, which DRF reserves
  for content negotiation and which 404s
- **One error envelope, everywhere:**

```json
{ "error": {
    "code": "business_rule_violation",
    "message": "2026-08-31 is outside the week beginning 2026-08-24.",
    "details": { "start_date": ["This field is required."] },
    "request_id": "8f1c2b..."
} }
```

- **`X-Request-ID`** is honoured inbound and echoed outbound, correlating SPA → API
  → logs.

### Endpoint map (abridged)

```
auth/          login, logout, password/change, password/forgot,
               token/refresh, me, entra/exchange
employees/     CRUD, me, my-team, org-chart, directory, directory/{id},
               {id}/photo, {id}/documents, {id}/bank-account, {id}/skills,
               search (?q= prefix, for people pickers),
               {id}/deletion-request (GET/POST/DELETE),
               {id}/complete-profile, {id}/profile-draft, {id}/experience
               list filters: ?search= ?department= ?employment_status= ?skills=
departments/   designations/   skills/                                CRUD
projects/      CRUD, {id}/members, {id}/allocations · my-allocations/
leaves/        list, create, me, pending-approvals (stage 1),
               hr-approvals (stage 2), team-calendar,
               {id}/approve, {id}/reject, {id}/send-back, {id}/cancel
leave-types/   leave-balances/ (+ /me), holidays/
timesheets/    list, me, weekly, current-week-summary, pending-approvals,
               {id}/entries, {id}/submit, {id}/approve, {id}/reject,
               status/by-project, status/by-employee, notify
payroll-runs/  CRUD, {id}/process, {id}/approve, {id}/reject,
               {id}/mark-paid, {id}/export
salary-structures/   payslips/ (+ /me, /latest, /periods,
                     {id}/pdf, {id}/process)
                     list filters: ?project= ?year= ?month=
finance/       approvals (+ {id}/approve, {id}/query)
notifications/ list, unread-count, {id}/read, read-all
reports/       employees, leave, timesheet, projects · dashboard/summary
               dashboard/birthdays (the year of birthdays behind the card)
admin/         users (+ {id}/roles, {id}/reset-password, delete —
               bulk POST taking {ids} or {all}; the caller is always skipped;
               list filters: ?search= (name, employee code, email)
               ?employment_status= ?department= ?skills=),
               roles, permissions, settings, audit-logs,
               deletion-requests (+ {id}/approve, {id}/reject)
```

---

## 9. Frontend architecture

- **Routing** (`src/app/router.tsx`) — every authenticated route sits behind
  `ProtectedRoute`; privileged areas add `RequireAccess` with permission codes.
  `src/app/router.test.ts` **pins which routes are and are not guarded** — that test
  exists because a route was once accidentally left inside a guard.
- **State** — Redux Toolkit, three slices: `auth` (the only place roles and
  permissions live), `ui` (sidebar, colour mode, toasts), `notifications` (unread
  badge, polled every 60s).
- **Data fetching** — no server-state library. Two hooks in
  `hooks/useApiResource.ts`: `useApiResource` for reads (data/loading/error/reload)
  and `useApiAction` for writes (busy flag, normalised error, field errors ready for
  form `helperText`).
- **API layer** — `services/api/endpoints.ts` (every path in one place) and
  `services/api/services.ts` (typed calls grouped per module). Components never
  touch axios.
- **Types** — `types/domain.ts` mirrors the DRF serializers one-for-one. DRF
  renders `DecimalField` as a **string**, so money and hours are typed `string` and
  parsed only where arithmetic is needed.
- **Theme** — `styles/theme.ts` exports `BRAND` (the logo colours). Everything
  derives from it, including the generated login background.

### UI conventions

- `PageHeader` for titles, `StatusChip` for any workflow/lifecycle state,
  `Feedback.tsx` for `ErrorAlert` / `TableSkeleton` / `EmptyState`.
- Wide content scrolls inside its own container; the page body never scrolls
  sideways.
- Permission-driven rendering via `usePermissions()` → `can`, `canAny`, `hasRole`.

---

## 10. The four workflows

### Onboarding a new joiner

```
Admin: Add user (email + temporary password)
   └─ raises the account AND the employment record (next TRG code,
      profile_completed = false) AND the employee role, in one transaction

Joiner: signs in on the ordinary login page with the temporary password
   └─ must_change_password forces the Set-your-password screen (no chrome:
      no sidebar or topbar until onboarding is done)
   └─ then the Complete Profile wizard — the portal is SHUT until it is
      submitted, enforced server-side on every endpoint, not just by redirect
   └─ Save draft keeps a half-filled form (validated but incomplete;
      never opens the portal); the wizard prefills from it next sign-in
   └─ submitting the whole profile flips profile_completed → the full
      employee sidebar appears
```

- There is **no separate registration page** — the register route was removed on
  26 August; the login page is the only door, and the router test pins the
  route's absence.
- Anything above the employee role is granted afterwards from the Employees
  table (Admin: a Change-role dialog; Super Admin: an inline dropdown).

### Leave

```
apply → PENDING ──approve──→ APPROVED
          │                     │
          ├──reject──→ REJECTED │
          └──cancel──→ CANCELLED ←── cancel (only before the start date)
```

- Applying **reserves** the days as `pending` on the balance.
- Approving moves pending → used. Rejecting releases them. Cancelling releases
  pending, or gives back used if the leave has not started.
- Weekends and mandatory holidays never consume leave.
- Balance changes and status changes happen in **one transaction**, with the balance
  row locked (`select_for_update`).
- Nobody approves their own request; managers only see their own branch.

### Timesheet

```
DRAFT ──submit──→ PENDING ──approve──→ APPROVED (locked)
  ↑                   │
  └──── reject ───────┘   (rejection requires a comment)
```

- The weekly sheet is created on first access (`GET /timesheets/weekly/?date=…`).
- Saving replaces the whole week in one PUT — deletion, edit and add are the same
  operation.

### Payroll (maker–checker)

```
DRAFT ──process──→ PROCESSED ──approve──→ APPROVED ──mark-paid──→ PAID
  ↑                    │
  └──── reject ────────┘   (requires a comment)
```

- **HR processes; an Admin approves. The same person cannot do both** — enforced in
  `approve_run()`. This is a deliberate financial control.
- Processing regenerates every payslip from scratch, so it is safe to re-run after
  a correction.
- **Payslips are hidden from employees until the run is approved.**
- Unpaid leave taken in the month becomes LOP days and is deducted pro-rata; leave
  straddling a month boundary is counted per month.
- **Rounding reconciles:** components are rounded individually then summed, and the
  withheld amount is derived from that sum, so `gross + withheld == full monthly
  gross` exactly. Do not "simplify" this.

---

## 11. Decisions taken, and why

| Decision | Reasoning |
| --- | --- |
| MUI over Ant Design | The diagram allowed either; one design system, and `@mui/x-data-grid` suits the table-heavy screens |
| Password login added alongside SSO | Explicitly requested, and SSO cannot be exercised without Entra app registrations |
| Entra token exchanged once for a portal JWT | Lets the JWT carry portal roles; avoids a JWKS check on every request |
| Tokens in `sessionStorage` | Smaller XSS blast radius than `localStorage`; dies with the tab |
| Fine-grained permission codes, not role checks in views | A custom role composes correctly; roles are just bundles |
| Separate `/employees/directory/` endpoint | The main employee list is deliberately scoped to self for an employee. Rather than widen it, a narrow directory (work contact details only, no personal data) is readable by everyone |
| Birthdays expose day and month only | Age is personal; the dashboard is company-wide |
| Payroll maker–checker | Standard financial control: the processor must not be the approver |
| Payslip amounts are snapshots | Last year's payslips must keep reconciling after a raise |
| Employees deactivated, never deleted | Leave, timesheet and payroll history references them |
| Projects cancelled, never deleted | Same |
| SQLite fallback for local dev | Docker is not installed on this machine; PostgreSQL everywhere else |
| Registration is the login page itself | The temp-password + forced-change flow already covered the whole journey; the separate register window was a second door to maintain and was removed |
| Every joiner starts as `employee` | An account with no role sees a sidebar of nothing; add-user raises account, employment record and baseline role together |
| Nobody edits their own roles or deletes their own account | Both happened or nearly happened in testing; somebody else must hold the pen |
| Super Admin's module is people governance only | Trimmed at the client's request: Employees with inline role control, nothing else — the role passes every permission check, so the trim is explicit nav data, not permissions |
| "Keep me signed in" moves tokens to `localStorage` | sessionStorage stays the default; persistence is the user's explicit choice |
| Leave types can be gender-restricted (`LeaveType.restricted_to_gender`) | Decided 27 Aug: maternity leave does not exist for anyone it excludes — no balance, no apply option — and stays out of the dashboard's headline total even for those who hold it, where 182 days would drown the ordinary year |

---

## 12. Environment traps (read before debugging anything odd)

These have each cost real time. They are environmental, not bugs in the code.

1. **The project sits in a OneDrive-synced folder.** Windows file events are
   unreliable there, and Vite can serve a **stale or empty module** while the file
   on disk is correct — producing errors like *"does not provide an export named
   'default'"* for a module that plainly exports it.
   *Mitigation already applied:* `vite.config.ts` sets `watch: { usePolling: true }`.
   *If it still happens:* `rm -rf frontend/node_modules/.vite` and restart with
   `npm run dev -- --force`. **Moving the project out of OneDrive would remove the
   root cause.**

2. **Adding the first runtime export to a types-only file** can leave Vite serving
   an empty module (same fix as above). This is how `BLOOD_GROUPS` broke once.

3. **The git repository root is `C:\Users\durga`** — the user's whole home
   directory — and it has **no commits**. `git status` inside the project lists
   ~133k files. Nothing here has ever been committed. Running `git init` inside
   `emp portal` would be the sensible fix; it has not been done because it was never
   authorised.

4. **Git Bash mangles large heredocs** on this machine. Write files with an editor
   tool, or short heredocs, not 200-line ones.

5. **`node` is not on the PATH that npm's lifecycle scripts see from Git Bash.**
   Run `npm` commands through PowerShell.

6. **Prettier reformats files**, so scripted find-and-replace against a remembered
   layout silently matches nothing. **Always assert that the pattern matched.** Two
   real bugs shipped from this: unbalanced JSX on the dashboard, and a route left
   inside a permission guard.

7. **Never use `toISOString().slice(0,10)` for calendar dates.** It converts to UTC
   first, so local midnight in IST becomes the previous day. Use
   `utils/date.ts` → `toIsoDate` / `todayIso` / `fromIsoDate`. This bug once made the
   timesheet grid edit a different week than it displayed.

8. **Docker is not installed here.** `docker-compose.yml` and both Dockerfiles are
   written and wired into CI, but have never been built or run locally.

---

## 13. Testing and quality gates

| Area | Command | Current |
| --- | --- | --- |
| Backend tests | `cd backend && .venv/Scripts/python.exe -m pytest -q` | **611 passing** |
| End-to-end walkthroughs | `cd backend && .venv/Scripts/python.exe manage.py e2e` | **15 walkthroughs, 608 checks, 0 failed** |
| Backend lint | `ruff check .` · `black .` | clean |
| Missing migrations | `manage.py makemigrations --check --dry-run` | clean |
| Deploy check | `DJANGO_SETTINGS_MODULE=config.settings.prod manage.py check --deploy` | clean |
| API schema | `manage.py spectacular --fail-on-warn --file ../docs/openapi.yaml` | clean |
| Frontend | `npm run lint` · `npm run typecheck` · `npm run test` · `npm run build` | **277 tests passing**, all clean |

The walkthroughs (`backend/tests/e2e/`, see its README) sign in as real demo
accounts and drive whole jobs through the API against a **throwaway copy** of
the database — they approve leave, process payroll and close accounts, and the
real `db.sqlite3` is untouched by a run. They are the layer that catches what
unit tests structurally cannot: permission codes no endpoint consults, sidebars
that disagree with the API, workflows that leave the wrong thing behind.

`conftest.py` provides the fixtures that matter — especially **`org`**, a small
organisation (hr, manager, employee, peer, outsider, admin) with real reporting
lines. Most scoping tests depend on it.

**Testing philosophy used here:** where a test guards against a regression that
actually happened, the fix was removed to confirm the test fails, then restored.
Do the same — a green test that never fails is worthless.

CI (`.github/workflows/ci.yml`) runs all of the above plus both Docker builds
against PostgreSQL and Redis service containers. It has never run (no remote).

---

## 14. Progress: what is done, what is not

### Done

| Phase | Scope |
| --- | --- |
| 0 | Monorepo, split settings, Docker compose, CI, error envelope, pagination, RBAC classes, request-ID correlation, OpenAPI |
| 1 | Identity: password + Entra SSO, users, roles, 49 permissions, `seed_rbac` |
| 2 | Employees: directory, profiles, photos, documents, departments, designations, org chart |
| 3 | Projects: portfolio, teams, allocations with the 100% rule |
| 4 | Leave: types, holidays, balances, apply/approve/reject/cancel, calendar |
| 5 | Timesheets: weekly grid, submission, approval, locking |
| 6 | Notifications (in-app + email), 4 reports, CSV export, role-aware dashboard |
| 7 | Administration: users, roles, settings, audit log |
| — | **Payroll** (added): salary structures, runs, payslips, maker–checker, bank sheet |
| — | **Branding**: logo mark, brand palette, generated animated login background |
| — | **Dashboard noticeboard**: upcoming birthdays and holidays for every role |
| — | **Assets**: per-employee register (serial, device, brand, photo), an Admin page over everyone, a My Assets page |
| — | **Birthday calendar**: `/birthdays` — the year month-by-month, behind the dashboard card's View more |
| — | **Onboarding v2** (26 Aug): register page removed; Add user raises account + employment record + employee role; profile gate with **drafts**; onboarding screens render without the portal chrome |
| — | **Administration v2** (26 Aug): tabs cut to Users + Assets; Users filter row matching the Employees page; per-row and multi-select account deletion with server-side self-protection |
| — | **Role management on the Employees table** (26 Aug): chips + Change-role dialog for Admin, inline dropdown for Super Admin; own-role changes refused server-side |
| — | **Super Admin module trimmed** (26 Aug) to the Employees list alone |
| — | **Company domain** migrated to `@trigyan.io` — code, seeds, live data and audit rows |
| — | **Holidays 2027** seeded; the seeder now always fills this year and next |
| — | **Always-on local hosting**: `start-portal.ps1` + a scheduled-task watchdog + a port-redirect helper |
| — | **The E2E walkthrough suite** moved into the repo with a `manage.py e2e` runner and hard database isolation |

New-features plan (`docs/NEW_FEATURES_PLAN.md`), delivered so far:

| Phase | Scope |
| --- | --- |
| 1 — Common UI | F1 close (X) on all 14 dialogs · F2 dashboard holiday card limited to the current month with "View more" · F3 holiday descriptions · F4 login background (already shipped) · new month-wise `/holidays` page |
| 2 — Timesheets | F5 per-day task description (note popover in the grid, shown in the approval breakdown, required on submit) · F6 approval tab renamed **Requests** · F7 HR **Submissions** tab with Project-based / Employee-based views and the Notify action |
| 4 — Profile, projects, skills | F10 bank details with D9 masking · F11 expandable team row on the projects list · F12 the `Skill` vocabulary, a shared `SkillPicker`, per-profile skills and the `?skills=` staffing filter on both the employee list and the directory |
| 3 — Leave | F8 CC recipients with `/employees/search/` and a shared `PeoplePicker` · F9 two-stage approval (D1/D2) with the `0003` data migration, an HR queue showing each applicant's remaining balance, HR send-back, and a two-step timeline on the employee's own requests |
| 6 — Account closure | F16 `AccountDeletionRequest`: HR raises it from the employee record, an administrator decides in Administration → Account closures. Approving deactivates and keeps every record; maker-checker stops the requester deciding |
| 5 — Payslips & Finance | F13 year → month drill-down and a ReportLab PDF (`EmployeeName_Year_Month.pdf`, net pay in words) · F14 `?project=` payslip filter with a project → employee → year → month drill-down · F15 the `apps/finance` module: `PayslipApproval`, the Finance role, HR's push-to-finance action, and a release/query queue |
| 7 — Password & registration | F17 forgot password: identical answer for every address, hashed temporary password, 30-minute expiry, single use, and token versioning that retires existing sessions · F18 the Complete Profile wizard behind a gate enforced in the authentication layer, plus experience records and itemised education document types |

**All 18 requested features are delivered.** What remains is in §14 "Not done"
and the plan's §9 backlog — chiefly the Azure deployment and real SMTP.

### Not done

- **Phase 8 — Azure deployment.** Nothing is provisioned. Dockerfiles, compose and
  CI exist but have never been executed. This is the largest remaining piece.
- **Entra ID SSO end to end.** The code path is written and unit-tested, but the
  SPA and API app registrations (with an `access_as_user` scope and admin consent)
  do not exist, so it has never been exercised against a real tenant.
- **Running on PostgreSQL locally.** Development uses the SQLite fallback.
- **Celery against a real broker.** Tasks run eagerly in-process locally.
- **Real outbound email.** Everything is written and tested against
  Django's console/locmem backend. The ask is with the company admin: SMTP
  credentials for `no-reply@trigyan.io` (a licensed mailbox with SMTP AUTH if
  Microsoft 365). Four lines in `backend/.env` and `manage.py mailtest`
  finish the job.
- **Production Docker compose.** The dev compose stack exists and mirrors the
  topology, but a production variant (gunicorn, built SPA behind nginx with
  TLS, real env, `restart: always`) is the remaining build work for internal
  hosting. The requirements list for the company admin — one Docker host, a
  DNS name, a TLS certificate, the mailbox — has been drafted.
- **Statutory payroll compliance.** PF/ESI/TDS are flat configured amounts, not
  computed against Indian slab rules. This is a demo-grade calculation.
- **`git init` inside the project.** See §12.3.
- **Mobile layout polish.** Responsive breakpoints exist and tables scroll, but the
  app has not been walked through on a phone.

---

## 15. How to extend it

### Add a permission-gated page

1. Add the code to `PERMISSIONS` in `backend/common/management/commands/seed_rbac.py`
   and to the relevant role lists. Re-run `seed_rbac`.
2. Add the same string to the `PermissionCode` union in `frontend/src/types/auth.ts`.
3. Guard the view: `required_permissions = ("your.code",)` with `HasModulePermission`.
4. Add the route in `frontend/src/app/router.tsx` (inside `RequireAccess` if gated)
   and **update `router.test.ts`**.
5. Add the sidebar entry in `frontend/src/components/layout/navigation.ts`.

### Add a module

Mirror an existing one — `apps/leave_management` is the fullest example:
`models.py` → `services.py` (business rules live here, **not** in views) →
`serializers.py` → `views.py` → `urls.py` → `admin.py` → `tests/`.
Register the app in `config/settings/base.py` and its urls in `config/urls.py`.

Keep to the house rules: scope querysets through `common/scoping.py`, raise
`BusinessRuleViolation` / `WorkflowStateError` rather than returning ad-hoc errors,
and call `record_audit(...)` on every state change.

### Regenerate the login background

`backend/.venv/Scripts/python.exe tools/make_login_background.py` — colours are read
from the same brand values as the theme. Keep dithering **off**; it inflated the GIF
roughly tenfold.

---

## 16. What comes next

The client's further 18 features (`HRMS New Features.docx`) are **all
delivered** — analysed, sequenced and estimated in
[docs/NEW_FEATURES_PLAN.md](docs/NEW_FEATURES_PLAN.md), then built in the agreed
order 1 → 2 → 4 → 3 → 6 → 5 → 7. That document's §1b records what landed in each
phase.

The five decisions that changed existing behaviour were **settled on 24 August
2026** and are now built:

- **Leave is two-stage** — Employee → Manager → HR, with the balance debited only
  at HR approval, and HR able to send a request back to the manager.
- **Finance is its own module** (`apps/finance`, own role and permissions),
  releasing payslips after the existing run-level approval.
- **Forgot password ships as an emailed temporary password** (hashed, expiring,
  single use); the signed reset link stays on the backlog as its replacement.
- **Registration is activation, not self-signup** — HR issues credentials, the
  employee resets the password and completes their profile before the portal
  opens.
- **Bank details are HR's and the employee's only**, masked everywhere else.

A demo-review round on 26 August then reshaped several of those decisions in
place — the register door was folded into the login page, onboarding gained
drafts, Administration and the Super Admin module were trimmed, and role
management moved onto the Employees table. §14's "Done" table carries the
line-by-line record.

What is left is not features:

- **Internal hosting** — the requirements email to the company admin is drafted
  (one Docker host, DNS name, TLS certificate, `no-reply@trigyan.io` mailbox);
  the production compose file and nginx config are the remaining build work.
- **Real outbound email** — blocked on the same admin request; the code path
  is finished.
- The **§9 backlog**, chiefly the signed 30-minute reset link and statutory
  payroll calculation.

## 17. Open questions for the client

1. Should HR also hold `payroll.approve`, collapsing the maker–checker control?
2. Is the company-wide directory acceptable, or should it be restricted to
   managers and HR?
3. Fiscal/leave year start month, for the annual accrual job.
4. Does the company already run an internal container platform, or should the
   portal get its own Docker host? (Determines item 1 of the hosting
   requirements email.)
5. Which festival holidays does Trigyan observe? The calendar carries only the
   fixed-date national days plus Foundation Day; Diwali, Holi, Ugadi et al.
   shift yearly and are HR's call.
6. Who can create the Entra app registrations, if SSO is to be exercised for
   real?
