# HRMS New Features — Implementation Plan

> **Historical planning document.** This is the plan as it stood before the
> build; it is kept as a record of what was decided and why, and is not
> maintained. The living description of the system — including the 26 August
> demo-review changes (onboarding reworked, Administration and Super Admin
> trimmed, role management moved to the Employees table) — is
> [PROJECT_HANDBOOK.md](../PROJECT_HANDBOOK.md).

**Source:** `HRMS New Features.docx` (18 features, 7 phases)
**Baseline:** the portal as described in [PROJECT_HANDBOOK.md](../PROJECT_HANDBOOK.md)
**Written:** 24 August 2026

This plan turns the feature document into buildable work. For each feature it
records what already exists, what is genuinely new, which decisions must be taken
before coding starts, and what it costs.

Read §2 (gap analysis) and §3 (decisions) before scheduling anything. Roughly a
third of the requested work is already built or half-built. Four features
conflicted with how the system works today; **the client settled all four on
24 August 2026** — see §3.

---

## 1. Summary

| | |
| --- | --- |
| Features requested | 18 across 7 phases |
| Already delivered | 3 (F4, F6, F11 substantially) |
| Partially delivered | 4 (F2, F5, F13, F16) |
| Genuinely new | 11 |
| New database tables | 7 |
| New migrations | ~9 |
| New Django app | 1 (**`apps/finance`**) |
| New role | 1 (**Finance**) |
| New third-party dependency | 1 (PDF generation) |
| **Estimated effort** | **≈52 developer-days**, ≈60 with QA and buffer |
| Calendar, 1 developer | ~11–12 weeks |
| Calendar, 2 developers | ~6 weeks (phases parallelise from Phase 3) |

**Three features block on infrastructure that does not exist yet.** F17 (forgot
password) needs real outbound email; F18 (education document uploads) needs real
blob storage; both are currently console/local stubs. That makes the outstanding
**Azure deployment (Phase 8 of the original plan)** a prerequisite rather than a
tail-end task — see §5.

---

## 1b. Delivery log

Built in the agreed order **1 → 2 → 4 → 3 → 6 → 5 → 7**.

| Phase | Delivered | What landed |
| --- | --- | --- |
| **1 — Common UI** | 24 Aug 2026 | `ClosableDialogTitle` applied to all 14 dialogs (4 tests); `Holiday.description` + migration `0002`; the dashboard card limited to the current month with "View more"; a new month-wise `/holidays` page open to everyone, with HR add/remove |
| **2 — Timesheets** | 24 Aug 2026 | Task description required on submit (the refusal names the first offending entry); note popover per grid cell, sent in the save payload; descriptions shown in the manager breakdown; approval tab renamed **Requests**; HR **Submissions** tab over `status/by-project`, `status/by-employee` and `notify`, gated on the new `timesheet.notify` permission |

| **4 — Profile, projects, skills** | 24 Aug 2026 | `BankAccount` with D9 masking (owner sees the number, HR sees four digits, managers see nothing) and a masked-only audit trail; expandable team row on the projects list; the `Skill` vocabulary + `seed_skills`, `EmployeeSkill`, a shared `SkillPicker` in `components/common/`, and the `?skills=` AND-filter on the employee list and the directory |

| **3 — Leave** | 24 Aug 2026 | `LeaveRequestCC` + `/employees/search/` + a shared `PeoplePicker`; two-stage approval with `LeaveStatus`/`LeaveStageStatus`, the `0003` add → back-fill → switch migration (tested forwards *and* backwards), an HR queue carrying each applicant's remaining balance, HR send-back with a mandatory reason, and a two-step timeline on the employee's own requests |

| **6 — Account closure** | 24 Aug 2026 | `AccountDeletionRequest` with a partial unique constraint on the open one; `employee.request_deletion` (HR) and `employee.approve_deletion` (Admin); approval reuses the existing deactivation path so nothing is deleted; maker-checker in the service, so even a Super Admin cannot grant their own request |

| **5 — Payslips & Finance** | 25 Aug 2026 | ReportLab payslip PDFs with the net in words (Indian scale) and `/payslips/periods/` behind a year → month drill-down; `?project=` filtering with a four-level HR drill-down; and `apps/finance` — a new app, the **Finance** role, `PayslipApproval`, HR's push-to-finance action and a release/query queue. Finance has no reject, and cannot release what it processed |

| **7 — Password & registration** | 25 Aug 2026 | F17: `POST /auth/password/forgot/` answering 204 for every address, a hashed single-use temporary password with a 30-minute window, and `token_version` retiring sessions on reset · F18: `profile_completed`, the Complete Profile wizard, `ExperienceDetail`, itemised education document types, and a gate enforced in the authentication class so it cannot be walked past by calling the API |

Test counts after Phase 7: **468 backend**, **130 frontend**.

**All 18 features are delivered.** What is left is the §9 backlog — chiefly the
Azure deployment, real SMTP (D13), and the signed reset link (B1) that replaces
the temporary password when it lands.

---

## 2. Gap analysis

Status against the codebase. The last column is the **original** assessment,
kept as written; where a row now says *Delivered*, §1b records what actually
shipped.

| # | Feature | Status | What is actually left |
| --- | --- | --- | --- |
| 1 | Popup close (X) button | **Delivered** | 14 dialogs across 9 files have Cancel but no X. Needs one shared component, applied everywhere |
| 2 | Dashboard holiday card | **Delivered** | The dashboard already shows upcoming holidays. Left: limit to next 4 *of the current month*, add "View More", build a month-wise Holidays page |
| 3 | Holiday description | **Delivered** | `Holiday` has `date`, `name`, `is_optional` only. Needs a field + migration + display in three places |
| 4 | Login background | **Done** | Animated brand GIF with a reduced-motion still. Left: the two new links (F17, F18), which belong with Phase 7 |
| 5 | Timesheet task description | **Delivered** | `TimesheetEntry.description` **already exists** in the model, serializer and API. The weekly grid simply never sends it. Frontend + manager/HR display only |
| 6 | Manager timesheet approval | **Delivered** | Submit already notifies the manager; the approvals queue with Approve/Reject exists and is tested. Left: rename the tab to "Requests" if wanted, and the HR handoff (part of F7) |
| 7 | HR timesheet management | **Delivered** | Project-based and employee-based views, submission status, Notify action. The largest item in Phase 2 |
| 8 | CC users on leave | **Delivered** | New table, a user-search endpoint, an autocomplete field, CC notifications |
| 9 | Two-stage leave approval | **Delivered** | Settled (D1, D2): Employee → Manager → HR, balance debited **only at HR approval**, HR can **send back to manager**. Touches the model, the service, existing rows and every leave test |
| 10 | Bank account details | **Delivered** | New table, sensitive-data visibility rules, masking |
| 11 | Project assigned employees | **Delivered** | The project detail page already lists team and allocations. Left: expand-in-place on the HR projects list |
| 12 | Employee skills filter | **Delivered** | New `Skill` table + join, autocomplete, filter on employee list and directory |
| 13 | Employee payslip page | **Delivered** | Payslips exist with a full breakdown. Left: year → month drill-down, and **PDF download** (new dependency) |
| 14 | HR project-based payslips | **Delivered** | Project → employee → year → month navigation |
| 15 | Finance payslip approval | **Delivered** | Settled (D7): a **separate `apps/finance` module** with its own role, permissions and sidebar entry, sitting after the existing run-level approval |
| 16 | Delete account workflow | **Delivered** | Deactivation already exists and already blocks login, and history is already preserved. Left: the HR-requests → Admin-decides workflow and its queue |
| 17 | Forgot password | **Delivered** | Settled (D8): temporary password by email, hashed, expiring, single use. Needs working outbound email |
| 18 | Registration / first login | **Delivered** | `must_change_password` exists. Needs a first-login flag, a Complete Profile wizard, extra document types, skills, experience |

---

## 3. Decisions

**Five were settled by the client on 24 August 2026** (D1, D2, D7, D8, D11) and are
marked ✅ below — those are now requirements, not proposals. The rest stand on the
recommendation given unless the client says otherwise.

### Settled

| # | Question | Client's decision | Consequence |
| --- | --- | --- | --- |
| **D1** ✅ | When is the leave balance debited? | **On HR approval only**, after the manager has approved | Days stay `pending` on the balance through the manager stage. Only `hr_approve()` moves pending → used |
| **D2** ✅ | HR has no Reject — what if HR disagrees? | **Implement "Send back to manager"** | A third transition on the HR stage returning the request to `pending_manager`, with a mandatory comment |
| **D7** ✅ | Where does Finance approval live? | **A separate Finance module** | No longer just a role: a new `apps/finance` Django app, a `finance.*` permission namespace and its own sidebar module. See F15 below — this grew the estimate |
| **D8** ✅ | Temporary password or signed reset link? | **Temporary password now**; the 30-minute single-use link goes on the backlog | Build the temp-password flow with expiry, single use and a forced change. Recorded in §9 |
| **D11** ✅ | Registration: self-signup or activation? | **Activation.** HR issues temporary credentials; the employee activates the account | No open sign-up endpoint. First login forces a password reset, then a mandatory profile page. **The portal is inaccessible until that profile is complete** — a hard gate, not a prompt |

### Still open

These change the shape of the work. Each carries a recommendation; none should be
guessed at during implementation.

| # | Question | Recommendation |
| --- | --- | --- |
| **D3** | Who approves leave for HR staff themselves, and for people with no reporting manager? | Route to Super Admin; keep the existing rule that nobody approves their own request |
| **D4** | "Latest timesheet" for the HR submission-status views — current week or last completed week? | **Last completed week** (the Monday–Sunday that ended before today). The current week is not yet due |
| **D5** | Task description — one per entry (project × day), or one per weekly timesheet? | **Per entry.** The column already exists and carries the most useful detail. Require at least one non-empty description at submit |
| **D9** | Who may see bank details? | **The employee and HR only.** Not managers. Mask all but the last four digits anywhere other than the owner's own profile |
| **D10** | Skills: free text or a controlled list? | **Controlled list** (`Skill` table), seeded and extendable by HR. The document asks for a dropdown of all skills, which requires a vocabulary |
| **D12** | Education/experience documents: size and type limits, and where stored? | 10 MB, PDF/JPEG/PNG. **Azure Blob Storage** — local disk is not viable for real document volumes |
| **D13** | Which SMTP provider and sender domain for real email? | Needed before F17 can ship. Currently email prints to the console |

---

## 4. Cross-cutting prerequisites

Do these once, before or alongside the phases that need them.

| Prerequisite | Needed by | Effort |
| --- | --- | --- |
| ~~**PDF generation** — ReportLab plus a payslip template~~ | F13, F14 | **Done in Phase 5** |
| **Working outbound email** — SMTP settings, sender domain, Celery worker against a real broker, delivery failure handling | F17, and all existing notifications | 1 d — **still outstanding**; F17 is built and tested against the console backend |
| **Azure Blob Storage in use** — the backend is configured for it but has never run against it | F18, F12 | part of Phase 8 |
| **Shared `ClosableDialog`** component | F1, and every dialog added afterwards | included in F1 |

---

## 5. Phase-by-phase plan

Each phase lists backend work, frontend work, tests, and the risks specific to it.
"Done" means: tests written and passing, `ruff`/`black`/`eslint`/`tsc` clean,
OpenAPI regenerated with no warnings, and the handbook updated.

---

### Phase 1 — Common UI · ≈4 days

**Goal:** consistency fixes and the holiday surface. No workflow changes, so this
is a safe warm-up that touches many files.

**F1 — Popup close button**
- Frontend only. Build `components/common/ClosableDialog.tsx` wrapping MUI
  `Dialog` with a red-tinted `IconButton` (`CloseIcon`) top-right, wired to the
  same handler as Cancel.
- Apply to all 14 dialogs in: `ApplyLeaveDialog`, `EmployeeFormDialog`,
  `DepartmentsPage` (×2), `LeaveHolidaysTab`, `ProjectsPage`,
  `ProjectDetailPage` (×2), `AdministrationPage` (×2), `PayrollRunsTab` (×2),
  `SalaryStructuresTab`.
- `EmployeeDetailsDialog` already has one — fold it into the shared component.
- **Test:** one render test asserting the X calls `onClose`.

**F2 — Dashboard holiday card + Holidays page**
- Backend: `upcoming_holidays()` already exists. Add a `current_month_only`
  option and a limit of 4; add `GET /holidays/?year=&month=` grouping support.
- Frontend: adjust the Noticeboard card, add a **View More** button, create a
  `/holidays` route showing the year grouped month-by-month, and a sidebar entry.
- **Decision applied:** D-none. Visible to every role.

**F3 — Holiday description**
- Backend: `Holiday.description = TextField(blank=True)` + migration; add to the
  serializer, the create form and `upcoming_holidays()`.
- Frontend: description in the holiday form, the holidays page and the dashboard
  card (truncated with a tooltip).

**F4 — Login page**
- Background is done. Add **Forgot Password** and **New Employee Registration**
  links, wired in Phase 7. Ship them disabled with a tooltip until then, or defer
  the links to Phase 7 — **recommended: defer**, to avoid dead controls.

**Risks:** low. F1 touches many files at once — do it in one pass, not piecemeal.

---

### Phase 2 — Timesheet Management · ≈6.5 days

**Goal:** make timesheets useful to HR, and capture what people actually did.

**F5 — Task description** *(backend already done)*
- Frontend: add a description input per grid cell. A cramped weekly grid cannot
  hold seven text boxes per row — **recommended interaction:** the hours cell
  gets a small note icon that opens a per-day popover, with a filled icon when a
  description exists.
- Send `description` in the save payload (`WeeklyGrid.buildPayload` currently
  drops it).
- Show the description in the manager approval breakdown and the HR views.
- **Validation (D5):** on submit, require a description on every entry.
- **Test:** submit with a blank description is refused; the description survives
  save → submit → approve.

**F6 — Manager approval** *(largely done)*
- Rename the "Approvals" tab to **Requests** if the client wants that wording.
- Verify the notification wording and link.
- On manager approval the sheet already becomes visible to HR through
  `timesheet.view_all` — confirm with a test rather than new code.

**F7 — HR timesheet page** — the substantial item
- Backend: new read endpoints
  - `GET /timesheets/status/by-project/?week=` → per project, its members and
    whether each submitted the week's sheet
  - `GET /timesheets/status/by-employee/?week=` → the same, flat
  - `POST /timesheets/notify/` → body of employee ids (or a project id) creating
    a notification for each non-submitter
  - "Latest week" resolved per **D4** (last completed week)
- Permissions: reuse `timesheet.view_all`; add `timesheet.notify` for the nudge
  action (HR + Super Admin).
- Frontend: a new HR tab with **Project Based** / **Employee Based** sub-tabs,
  status chips (submitted / not submitted / approved), and a Notify button per
  project and per employee.
- **Tests:** status is computed for the right week; Notify creates exactly one
  notification per non-submitter and none for submitters; an employee cannot call
  the notify endpoint.

**Risks:** the status query is N+1-prone across projects × members — write it as a
single annotated query and assert the query count in a test.

---

### Phase 3 — Leave Management · ≈8 days

**Goal:** CC visibility, and the two-stage approval the business actually uses.
**This phase changes existing behaviour and existing data.** Schedule it when
someone can babysit the migration.

**F8 — CC users**
- Backend: `LeaveRequestCC` (leave_request, user, notified_at) — a table rather
  than a bare M2M so the notification can be recorded.
- New `GET /employees/search/?q=` returning id, name, employee code and photo for
  the autocomplete (prefix match on first/last name, per the document).
- On apply, notify every CC user.
- Frontend: an MUI `Autocomplete` (multiple, async) in the leave form, showing
  chips for the people added.
- **Tests:** prefix search; multiple CC; every CC user is notified once; CC does
  not grant any extra visibility of the request.

**F9 — Two-stage approval** — the riskiest change in the plan
- Model: replace the single `status` transition with explicit stages.
  Recommended shape: keep `status` as the overall state and add
  `manager_status` / `manager_decided_by` / `manager_decided_at` and
  `hr_status` / `hr_decided_by` / `hr_decided_at`. Overall status becomes
  `pending_manager` → `pending_hr` → `approved`, with `rejected` reachable only
  from the manager stage (per D2, plus "send back" from HR).
- Service: `approve_leave()` splits into `manager_approve()` and `hr_approve()`.
  **Balance timing per D1:** days stay `pending` until HR approves.
- **Data migration:** existing `approved` rows must be back-filled as
  manager-approved *and* HR-approved so history stays consistent; existing
  `pending` rows become `pending_manager`. Write it as add → back-fill → switch,
  and test the reverse.
- HR queue must show the applicant's **remaining balance** alongside each request.
- Frontend: a new HR approvals tab; the employee's request timeline shows both
  stages.
- **Tests:** the full happy path; manager rejection stops the flow; HR send-back
  returns it to the manager; balance moves only at HR approval; the data
  migration converts old rows correctly.

**Risks:** every existing leave test asserts single-stage behaviour and will need
revisiting — budget for that. Do not let this phase run concurrently with any
other leave work.

---

### Phase 4 — Profile, Projects, Skills · ≈6.5 days

**F10 — Bank details**
- Backend: `BankAccount` (one-to-one with Employee): bank name, account holder,
  account number, IFSC, branch. Validate IFSC (`^[A-Z]{4}0[A-Z0-9]{6}$`).
- Permissions: `bank.view_self`, `bank.manage` (HR). Per **D9**, managers are
  excluded; mask all but the last four digits outside the owner's own view.
- Audit every change — bank details are a fraud target.
- Frontend: a section in My Profile (editable) and in the HR employee record.
- **Tests:** an employee edits only their own; a manager gets 403; masking works;
  changes are audited.

**F11 — Project assigned employees** *(mostly exists)*
- Frontend: expandable row in the HR projects list, reusing the member and
  allocation data the detail page already fetches.

**F12 — Skills**
- Backend: `Skill` (name, category, is_active) and `EmployeeSkill`
  (employee, skill, proficiency?, years?). Seed a starter vocabulary (D10).
- `GET /skills/?q=` for autocomplete; `?skills=1,2` filter on the employee list
  **and** the company directory.
- Frontend: a skills filter (multi-select) alongside the existing name /
  designation / department filters — those must keep working.
- **Tests:** filtering by one and several skills; existing filters unaffected.

**Risks:** low, except that F12's autocomplete is reused by F18 — build it once,
in `components/common/`.

---

### Phase 5 — Payslip Management · ≈11 days

The largest phase, and the one with a new dependency and a new role.

**F13 — Employee payslip page + PDF**
- Backend: `GET /payslips/periods/` returning `{year: [months]}` for the
  drill-down; `GET /payslips/{id}/pdf/` streaming a generated PDF.
- PDF: ReportLab, laid out with the company logo, earnings/deductions table,
  attendance basis and net pay in words. Filename exactly
  `EmployeeName_Year_Month.pdf`.
- Frontend: replace the flat accordion with year → month → payslip, and a
  Download button at the top.
- **Tests:** the PDF is generated with the right content type and filename; an
  employee cannot download a colleague's payslip.

**F14 — HR project-based payslips**
- Backend: reuse the project→employee data; add
  `GET /payslips/?project=&employee=&year=&month=`.
- Frontend: Projects section with the four-level drill-down.

**F15 — Finance module** *(D7: a separate module, not just a role)*

A new Django app and a new sidebar module, not a bolt-on to Payroll. Payroll owns
*calculating* pay; Finance owns *releasing* it.

- **New app `apps/finance`**
  - `PayslipApproval` (payslip, status, processed_by, processed_at,
    approved_by, approved_at, comment) — a table rather than status columns on
    `Payslip`, so the release history is auditable in its own right and Payroll
    stays unaware of Finance's internals.
  - Status: `pending` → `processed` (HR pushed it) → `approved` (Finance released
    it), with `queried` as the send-back state so Finance can raise an issue
    without a dead end — the same lesson as D2.
- **New role `finance`** in `RoleSlug`, `seed_rbac` and the frontend role union.
- **New permission namespace**
  - `finance.view` — see the Finance module
  - `finance.approve` — release a payslip (Finance, Super Admin)
  - `payroll.push_to_finance` — HR's "Process" action
- **Endpoints:** `POST /payslips/{id}/process/` (HR → notifies Finance),
  and under the new app: `GET /finance/approvals/`,
  `POST /finance/approvals/{id}/approve/`, `POST /finance/approvals/{id}/query/`.
- **Sequence:** Admin approves the *run* (bulk correctness) → HR pushes individual
  payslips → Finance releases each one. Label each stage in the UI so nobody
  wonders which approval they are looking at.
- **Frontend:** a Finance entry in the sidebar with a pending-approvals queue,
  per-payslip detail, and approve / query actions. Reuses the payslip breakdown
  component from F13.
- **Seed:** a demo Finance account so the flow is testable end to end.
- **Tests:** HR cannot finance-approve; Finance cannot process; a queried payslip
  returns to HR; the Finance role sees only the Finance module; notifications
  reach the Finance account.

**Risk:** payroll now has two approval concepts (run-level and payslip-level).
Mitigate with explicit stage labels and a status timeline on the payslip.

---

### Module 6 — Account deletion workflow · ≈3 days

**F16** *(deactivation itself already exists)*
- Model: `AccountDeletionRequest` (employee, requested_by, requested_at, status,
  decided_by, decided_at, reason, decision_note).
- Endpoints: `POST /employees/{id}/deletion-request/` (HR),
  `GET /admin/deletion-requests/`, `POST /admin/deletion-requests/{id}/approve/`
  and `/reject/`.
- Permissions: `employee.request_deletion` (HR), `employee.approve_deletion` (Admin).
- On approval reuse the existing deactivation path: `employment_status → inactive`,
  `user.is_active → False`. **Nothing is deleted** — already true and already
  tested.
- Frontend: a Delete Profile button on the HR employee record, and a **Delete
  Accounts** section in Administration with the pending queue.
- **Tests:** HR cannot self-approve; a rejected request leaves the employee active;
  an approved one blocks login while leaving leave, timesheets and payslips intact.

---

### Phase 7 — Password & Registration · ≈9 days

Depends on working email (§4). Highest security sensitivity in the plan.

**F17 — Forgot password**
- **Per D8 the client chose the temporary password**, so build that now:
  `POST /auth/password/forgot/` accepts an email and *always* returns 204 (never
  reveal whether an account exists), then emails a generated temporary password.
- Store only its **hash**, with a **short expiry** (recommend 30 minutes),
  **single use**, and `must_change_password` forced on the account. Signing in
  with it lands straight on the change-password screen.
- The 30-minute signed reset link stays on the backlog (§9) as the eventual
  replacement — build this flow so the delivery mechanism can be swapped without
  touching the reset logic.
- Throttle hard — reuse the existing `login` scope.
- All outstanding refresh tokens must stop working after a reset.
- Frontend: the login-page link, a request form and a reset form.
- **Tests:** unknown emails give an identical response; an expired or reused token
  is refused; the old password stops working; throttling engages.

**F18 — Registration / first login / complete profile**
- Model: `Employee.profile_completed` flag; extend
  `EmployeeDocument.DocumentType` with `tenth`, `intermediate`, `bachelors`,
  `masters`, `experience_letter`, `other_education`; add an `ExperienceDetail`
  table (company, title, from, to, description).
- **Confirmed flow (D11).** HR creates the account and issues temporary
  credentials — there is no self-signup endpoint. Then:
  1. Employee signs in with the temporary credentials.
  2. **Immediately forced** to reset the password (the existing
     `must_change_password` gate already does this).
  3. Lands on the **Complete Profile** page — *only* on first login.
  4. Enters every mandatory detail and submits.
  5. `profile_completed = true`; the portal opens.
- **The gate is hard:** until the profile is complete the employee cannot reach
  the dashboard or any module. Implement it the same way as the
  `must_change_password` redirect in `AppLayout`, and enforce it server-side too
  so it cannot be bypassed by calling the API directly.
- Route guard: like the existing `must_change_password` redirect, an incomplete
  profile redirects to the wizard.
- Optional afterwards, in My Profile: skills (reusing F12's autocomplete),
  the education documents, experience details, other documents.
- Frontend: a multi-step wizard; a documents section with an upload per type.
- **Tests:** the guard cannot be bypassed by typing a URL; the flag flips only
  when every mandatory field is present; uploads honour the type and size limits.

**Risks:** this is the first flow an employee ever sees — get the copy right.
Confirm **D11** before building: activation and open self-signup are very different
security models.

---

## 6. Sequencing and dependencies

```
Phase 1 (UI)            ──┐
                          ├── independent, can start immediately
Phase 4 (bank, skills)  ──┘

Phase 2 (timesheets)    ── independent

Phase 3 (leave)         ── touches existing data; run alone

Phase 5 (payslips)      ── needs: Finance role, PDF library
                        └─ F14 needs F13's drill-down components

Module 6 (deletion)     ── independent, small

Phase 7 (auth)          ── needs: working SMTP (F17)
                        ── needs: F12 skills autocomplete (F18)
                        ── needs: blob storage for documents (F18)
                        └─ completes F4's login links
```

**Suggested order for one developer:** 1 → 2 → 4 → 3 → 6 → 5 → 7.
Phase 4 before 3 because F12's autocomplete is reused later, and because Phase 3
deserves a clear run.

**With two developers:** one takes 1 → 2 → 3 (workflow-heavy), the other takes
4 → 6 → 5 (data and reporting). Phase 7 joins them at the end, after the email and
storage prerequisites land.

---

## 7. Effort summary

| Phase | Features | Days | Note |
| --- | --- | ---: | --- |
| Prerequisites (PDF library, SMTP) | — | 2.5 | Finance role folded into F15 |
| 1 — Common UI | F1–F4 | 4 | |
| 2 — Timesheets | F5–F7 | 6.5 | |
| 3 — Leave | F8–F9 | 8 | D1 + D2 settled; two-stage with send-back |
| 4 — Profile, projects, skills | F10–F12 | 6.5 | |
| 5 — Payslips & Finance | F13–F15 | 12.5 | **+1.5** — F15 is now a module, not a role |
| 6 — Account deletion | F16 | 3 | |
| 7 — Password & registration | F17–F18 | 9 | Temp-password flow per D8 |
| **Subtotal** | | **52** | |
| QA, review, fixes (~15%) | | 8 | |
| **Total** | | **≈60 developer-days** | |

Excludes the outstanding **Azure deployment**, which is separate work but is now
on the critical path for Phase 7.

---

## 8. Risk register

| Risk | Impact | Handling |
| --- | --- | --- |
| Two-stage leave migration corrupts existing requests | High | Add → back-fill → switch; test the reverse migration; take a database copy first |
| Two payroll approval concepts confuse users | Medium | **Settled (D7):** Finance is a separate module. Label each stage and show a status timeline on the payslip |
| Emailing temporary passwords is a weak practice | High | **Accepted by the client (D8).** Mitigate: hash at rest, 30-minute expiry, single use, forced change, hard throttling. Replacement tracked in §10 |
| Bank details are a fraud target | High | HR + self only, masked elsewhere, every change audited |
| Document uploads outgrow local disk | Medium | Move to Azure Blob before Phase 7 |
| Timesheet status queries go N+1 | Medium | Single annotated query; assert query count in a test |
| Weekly grid becomes unusable with 7 description boxes per row | Medium | Popover-per-day interaction, not inline text fields |
| Feature creep in "Complete Profile" | Medium | Mandatory set agreed in writing before F18 starts |

---

## 9. Backlog (agreed, not scheduled)

Recorded here so they are not lost. None is in the 60-day estimate.

| # | Item | Origin | Notes |
| --- | --- | --- | --- |
| B1 | **30-minute single-use signed reset link**, replacing the emailed temporary password | D8, deferred by the client | Build F17 so the delivery mechanism can be swapped without touching the reset logic. ~1.5 d once email is live |
| B2 | Azure deployment (original Phase 8) | Handbook §14 | Now a prerequisite for Phase 7, not a tail-end task |
| B3 | Entra ID SSO exercised against a real tenant | Handbook §14 | Needs app registrations and admin consent |
| B4 | Statutory payroll (PF/ESI/TDS against Indian slab rules) | Handbook §14 | Current amounts are flat configured values |
| B5 | `git init` inside the project | Handbook §12.3 | No commits exist; the repo root is the user's home directory |

---

## 10. Definition of done (every feature)

1. Backend rules live in a `services.py`, not in views.
2. Querysets scoped through `common/scoping.py`; permissions declared, never implied.
3. `record_audit(...)` on every state change.
4. Tests: happy path, each refusal, and each permission boundary. Where a fix
   guards a regression, the test is confirmed to fail without the fix.
5. `ruff` / `black` / `eslint` / `tsc` clean; `makemigrations --check` clean.
6. OpenAPI regenerates with `--fail-on-warn`.
7. Frontend shows the server's message on failure — never a generic one.
8. [PROJECT_HANDBOOK.md](../PROJECT_HANDBOOK.md) updated: model, permissions,
   workflow and progress sections.
