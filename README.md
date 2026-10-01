# Trigyan Employee Management Portal

Internal portal for managing employees, projects, leave and timesheets, with
Microsoft Entra ID single sign-on and role-based access control.

**Stack** (per the architecture document): React + TypeScript + Redux Toolkit +
MUI on the frontend; Django + Django REST Framework on the backend; PostgreSQL,
Redis, Celery, Azure Blob Storage; Docker images deployed to Azure; OpenAPI /
Swagger for API documentation; Azure Application Insights for monitoring.

> **New to this project?** Read [PROJECT_HANDBOOK.md](PROJECT_HANDBOOK.md) —
> a full account of the objective, architecture, domain model, permissions,
> workflows, progress and known traps.

## Repository layout

```
emp portal/
├── backend/                  Django REST API
│   ├── config/               settings (base/dev/test/staging/prod), urls, wsgi, asgi, celery
│   ├── apps/
│   │   ├── authentication/   users, roles, permissions, Entra ID SSO exchange
│   │   ├── employees/        employees, departments, designations, documents
│   │   ├── projects/         projects, members, allocations
│   │   ├── leave_management/ leave types, balances, requests, approvals, holidays
│   │   ├── timesheets/       timesheets, entries, approvals
│   │   ├── notifications/    in-app + email notifications
│   │   ├── reports/          reports and analytics
│   │   └── administration/   users, roles, system config, audit logs
│   ├── common/               permissions, middleware, pagination, error handling, enums
│   └── requirements/         base / dev / prod
├── frontend/                 React + TypeScript SPA
│   └── src/
│       ├── app/              store, router, providers, typed hooks
│       ├── features/         auth, employees, projects, leave, timesheet, reports, admin
│       ├── components/       common, forms, tables, charts, layout
│       ├── services/         api client + endpoints, MSAL auth
│       ├── hooks/  types/  utils/  styles/  assets/
├── docker-compose.yml        local stack: postgres, redis, api, celery, beat, spa
├── .github/workflows/ci.yml  lint, type-check, test, build, docker
└── docs/openapi.yaml         generated API schema
```

## Getting started

### Option A - Docker (matches the deployed topology)

```bash
docker compose up --build
```

- API: http://localhost:8000 (Swagger UI at http://localhost:8000/api/docs/)
- SPA: http://localhost:5173

Migrations and RBAC seeding run automatically on backend start. Add demo data
with `docker compose exec backend python manage.py seed_demo_data`.

### Option B - without Docker

The backend falls back to SQLite and an in-memory cache when PostgreSQL and
Redis are not available, so the stack still boots.

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate elsewhere
pip install -r requirements/dev.txt
cp .env.example .env            # then set USE_SQLITE=1 and USE_LOCMEM_CACHE=1
python manage.py migrate
python manage.py seed_rbac       # 6 roles, 49 permission codes
python manage.py seed_demo_data  # demo organization (DEBUG only)
python manage.py runserver

# Frontend (second terminal)
cd frontend
npm install
cp .env.example .env.local      # Entra ID values optional; password login works without them
npm run dev
```

Open **http://localhost:5173** (or http://127.0.0.1:5173 — the dev server binds
IPv4 loopback explicitly so both work; left to itself Vite binds `::1` alone on
Windows and one of the two is refused).

Sign in with any demo account and `Portal@123`, e.g. `asha.rao@trigyan.io`
(employee), `priya.menon@trigyan.io` (HR), `vikram.nair@trigyan.io` (manager).

For an always-on local setup (demo bundle on :4173, restarted automatically
after crashes and reboots), run `tools/install-autostart.ps1` once — see the
handbook §2.

The SPA calls the API through Vite's `/api` proxy, so the backend must be
running on port 8000 first — a page that loads but shows a network error on
sign-in almost always means it is not.

### Starting it (one command)

```powershell
powershell -ExecutionPolicy Bypass -File tools\start-portal.ps1
```

Starts the API and the portal in two windows that stay open, waits until both
answer, prints the sign-in accounts and opens the browser. Add `-Dev` for the
Vite dev server with hot reload instead of the built bundle, and `-SkipBuild` to
reuse the last build. Closing a window stops that server.

### Running a demo

For anything you cannot afford to have wobble, run the **production bundle**
rather than the dev server. The dev server fetches each page's chunk over HTTP
as you navigate, so if it restarts mid-session the open tab starts failing with
"Failed to fetch dynamically imported module". A built bundle has no such
dependency.

```bash
cd backend  && python manage.py runserver          # terminal 1
cd frontend && npm run build && npm run preview    # terminal 2
```

Then open **http://127.0.0.1:4173**. `preview` proxies `/api` and `/media` to
port 8000 exactly as the dev server does.

### Troubleshooting a local run

**`npm run dev` fails with `'"node"' is not recognized`** — and only in Git Bash,
while PowerShell works. Node is installed, but the PATH entry for it is
`C:\Program Files\nodejs\` *with a trailing backslash*. Git Bash drops that
entry when it converts PATH for the `cmd.exe` children npm uses to run scripts,
so the shim cannot find `node`. Add the same directory **without** the trailing
backslash to your user PATH, then open a new terminal:

```powershell
[Environment]::SetEnvironmentVariable(
  'Path', [Environment]::GetEnvironmentVariable('Path','User') + ';C:\Program Files\nodejs', 'User')
```

**The page will not load at http://127.0.0.1:5173** — fixed: `vite.config.ts`
now binds IPv4 loopback explicitly. Left to itself Vite binds whatever
`localhost` resolves to, which on Windows is `::1` alone, so one of the two
addresses was refused.

**The page loads but sign-in fails, or a panel shows "Network Error"** — the
backend is not up. The SPA reaches the API through Vite's `/api` proxy to port
8000, so `manage.py runserver` has to be running.

**"Failed to fetch dynamically imported module"** — pages are lazy-loaded, so
each one is fetched on navigation. This means the dev server stopped or
restarted while the tab was open: the app in the tab is looking for chunk names
that no longer exist. Restart `npm run dev` and reload. The app now catches this
itself and reloads once rather than showing React Router's error screen — see
`components/common/RouteError.tsx`.

## Quality gates

| Area     | Command                                                       |
| -------- | ------------------------------------------------------------- |
| Backend  | `ruff check .` · `black .` · `pytest` · `manage.py check`      |
| Frontend | `npm run lint` · `npm run typecheck` · `npm run test` · `build` |
| API docs | `python manage.py spectacular --fail-on-warn --file ../docs/openapi.yaml` |

CI runs all of the above plus a `makemigrations --check` guard, a
`check --deploy` pass against production settings, and both Docker builds.

## Authentication

Two ways in, both ending in the same portal JWT pair:

**Email and password** (used locally, and for accounts without SSO)
`POST /api/v1/auth/login/` with `{email, password}`. HR issues a temporary
password when onboarding; `must_change_password` then forces a reset before the
portal can be used.

**Microsoft Entra ID SSO** (production)
1. The SPA acquires an Entra ID access token via MSAL.
2. It posts that token once to `POST /api/v1/auth/entra/exchange/`.
3. The backend validates it against the tenant JWKS, provisions or updates the
   user, and returns the portal JWT pair.

Every subsequent request uses the portal JWT; `/auth/token/refresh/` rotates it,
and the axios interceptor retries the original request transparently.

### Demo accounts

`python manage.py seed_demo_data` creates a 14-person organization. Every demo
account uses the password **`Portal@123`**:

| Email | Role | Good for seeing |
| ----- | ---- | --------------- |
| `sneha.kulkarni@trigyan.io` | Super Admin | the trimmed people-governance module: Employees with inline role control |
| `rahul.iyer@trigyan.io` | Admin | Administration (Users + Assets), onboarding, account deletion, payroll approval |
| `priya.menon@trigyan.io` | HR | full directory, leave policy, holidays |
| `fatima.sheikh@trigyan.io` | Finance | releasing payslips, raising queries |
| `vikram.nair@trigyan.io` | Manager | approval queues, team scope |
| `asha.rao@trigyan.io` | Employee | own leave, timesheet, projects |

### Roles

| Role        | Scope                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| Super Admin | Full access to all modules and system settings                             |
| Admin       | Users, roles, permissions, projects, configuration, system reports         |
| HR          | Employees, leave policies, holidays, organization reports                  |
| Manager     | Approves leave and timesheets, manages team, assigns projects, views reports |
| Employee    | Own profile, leave application, timesheet submission, project visibility   |

Authorization is enforced on the backend for every request through permission
codes (`leave.approve`, `employee.view_all`, ...). The frontend uses the same
codes only to decide what to render.

## API conventions

- Versioned under `/api/v1/`; schema at `/api/schema/`, Swagger at `/api/docs/`.
- Bearer JWT authentication, RBAC on every endpoint.
- Pagination: `?page=2&page_size=50`, with `count`/`total_pages`/`results`.
- Report CSV export uses `?export=csv` (`format` is reserved by DRF's content
  negotiation).
- Filtering, search and ordering via `django-filter` + DRF backends.
- One error envelope everywhere:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The submitted data is invalid.",
    "details": { "start_date": ["This field is required."] },
    "request_id": "8f1c2b..."
  }
}
```

- `X-Request-ID` is honoured on the way in and echoed on the way out, so a
  single id correlates SPA, API and Application Insights.

## Roadmap

| Phase | Scope                                                           | Status |
| ----- | --------------------------------------------------------------- | ------ |
| 0     | Monorepo, tooling, CI, Docker, error/permission/pagination core  | Done   |
| 1     | Identity & access: password + SSO, users, roles, permissions     | Done   |
| 2     | Employee & org foundation, documents, org chart                  | Done   |
| 3     | Project management: teams and allocations                        | Done   |
| 4     | Leave management: policies, balances, approval workflow          | Done   |
| 5     | Timesheet management: weekly grid, submission, approval          | Done   |
| 6     | Notifications, reports & analytics, CSV export                   | Done   |
| 7     | Administration: users, roles, settings, audit log                | Done   |
| 8     | Azure deployment & go-live                                       | Pending |

See [PROJECT_HANDBOOK.md](PROJECT_HANDBOOK.md) for the full picture, or
[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the original phase plan.
