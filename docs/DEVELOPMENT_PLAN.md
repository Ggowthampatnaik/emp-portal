# Development plan

> **This is the original phase plan, kept for history.** For the current state
> of the project — architecture, domain model, permissions, workflows, what is
> done and what is not — see [PROJECT_HANDBOOK.md](../PROJECT_HANDBOOK.md),
> which is the source of truth.

Roughly 19-20 weeks (ten two-week sprints) for v1.0 with 2 backend, 2 frontend,
1 QA and a part-time DevOps engineer. Phase order is driven by data
dependencies, not by module size: projects land before timesheets because
timesheet entries book against projects.

Every phase ships with serializer validation, RBAC tests, backend pytest and
frontend Vitest coverage, updated OpenAPI docs, and audit logging on
state-changing actions.

**The bullets under each phase describe what was originally planned.** Where
the delivered work differs, section 14 of the handbook is authoritative; the
notable gaps are called out inline below.

---

## Phase 0 - Foundation — **done**

- Monorepo: `backend/` (config, apps, common) + `frontend/` (app, features, components, services, hooks, types, utils, styles, assets).
- Split settings (base/dev/test/staging/prod), env-driven config, `.env.example`.
- Docker Compose: PostgreSQL, Redis, API, Celery worker, Celery beat, SPA.
- Cross-cutting core: `X-Request-ID` middleware, correlated logging, standard
  pagination, one error envelope, JSON 404/500 handlers, RBAC permission classes,
  abstract base models (timestamps, UUID, auditable, soft delete).
- OpenAPI via drf-spectacular, including the Entra ID security scheme.
- CI: ruff, black, mypy (advisory), Django deploy check, missing-migration guard,
  pytest + coverage, schema generation, ESLint, Prettier, tsc, Vitest, Vite
  build, both Docker images.

## Phase 1 - Identity & access — **done**

- Custom `User` (email as username, Entra `oid`), `Role`, `ModulePermission`, `UserRole`.
- Entra ID token validation against tenant JWKS, just-in-time user provisioning,
  exchange for a portal JWT pair, refresh, `/auth/me`, logout.
- `seed_rbac` management command: 5 roles, 39 permission codes, idempotent.
- Frontend: MSAL sign-in, auth slice, token storage, silent refresh with request
  replay, `ProtectedRoute` + `RequireAccess` guards, permission-filtered sidebar.

## Phase 2 - Employee & org foundation — **done**

- Models: `departments`, `designations`, `employees`, `employee_documents`.
- `GET /employees/me`, employee CRUD, org-structure tree, document and profile
  photo upload. *Delivered against local media storage; the Azure Blob backend
  is configured in `prod.py` but has never been exercised.*
- Manager visibility scoped to their whole reporting branch, not only direct
  reports; HR/Admin see the organization. A separate company directory was
  added later, readable by everyone.
- Frontend: directory (DataGrid, search + filters), profile view/edit,
  department/designation admin, org chart.

## Phase 3 - Project management — **done**

- Models: `projects`, `project_members`, `project_allocations`.
- Project CRUD, team assignment, allocation percentages with total-allocation validation.
- Frontend: project list/detail, team assignment, allocation view.

## Phase 4 - Leave management — **done**

- Models: `leave_types`, `leave_balances`, `leave_requests`, `leave_approvals`, `holidays`.
- Workflow: apply → pending → manager approve/reject → balance update → notification.
- Validation: overlapping requests, sufficient balance, holidays and weekends
  excluded from day counts, cancellation rules.
- Celery: approval emails. *The annual accrual/reset beat job was not built.*
- Frontend: apply form, my leave, balance widget, manager approval queue,
  holiday calendar, leave-type policy admin.

## Phase 5 - Timesheet management — **done**

- Models: `timesheets`, `timesheet_entries`, `timesheet_approvals`.
- Workflow: draft → submit → manager review → approved/rejected (rejected
  returns to draft); approved timesheets lock.
- Validation: daily hour ceiling, project must be allocated to the employee,
  no entries on approved periods.
- Frontend: weekly grid, daily entry, submission flow, manager review screen.

## Phase 6 - Notifications, reports & analytics — **done**

- In-app notifications + email delivery through Celery; notification centre and
  unread badge.
- Employee, leave, timesheet and project reports; **synchronous CSV** export via
  `?export=csv`; role-aware dashboard tiles. *Excel export, asynchronous
  generation, Redis-cached aggregates and charts were not built.*

## Phase 7 - Administration & hardening — **done**

- User management, role/permission editor, system configuration, audit-log viewer.
- Security: RBAC enforced on every endpoint and covered by tests; login/report
  throttling; `check --deploy` clean. *Key Vault, dependency scanning and
  container scanning were not done — they belong with Phase 8.*
- Performance: `select_related`/`prefetch_related` used throughout, and indexes
  on the hot paths. *No formal profiling pass or cache strategy.*

## Phase 8 - Deployment & go-live — **not started**

- Azure: Front Door → Application Gateway → container apps (SPA + API),
  Azure Database for PostgreSQL, Azure Cache for Redis, Blob Storage, ACR.
- Release step per environment: `migrate` → `seed_rbac` → `collectstatic`.
- Promotion path Dev → Staging → UAT → Production; Application Insights
  dashboards and alerts; backup/restore drill; UAT sign-off; cutover.

---

## Decisions taken

| Decision                            | Choice                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| UI library (document lists MUI/Ant) | **MUI** - one design system, `@mui/x-data-grid` for the table-heavy screens |
| Entra token handling                | Validate once, exchange for a portal JWT (lets the JWT carry portal roles) |
| Token storage                       | `sessionStorage` - smaller XSS blast radius than `localStorage`         |
| Permission model                    | Fine-grained codes grouped into roles, not role checks scattered in views |
| Soft delete                         | Available as a base model; used where audit history must survive deletion |
| Local dev without Docker            | SQLite + locmem fallback behind env flags; PostgreSQL everywhere else   |

## Open items

- **Entra ID app registrations** (SPA + API, with `access_as_user` scope and
  admin consent) are needed before SSO can be tested end to end. Until the
  values are set, the login page states that SSO is unconfigured.
- Confirm the fiscal/leave year start for the accrual job (Phase 4).
- Confirm whether timesheets are weekly-only or weekly + daily submission
  (both views are planned; only the submission unit needs deciding).
