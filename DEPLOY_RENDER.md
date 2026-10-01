# Deploying to Render

Three Render resources, all described in [`render.yaml`](render.yaml):

| Resource | Type | What it runs |
|---|---|---|
| `emp-portal-db` | PostgreSQL 16 | The database, restored from `database/emp_portal_postgres.sql.gz` |
| `emp-portal-api` | Web Service (Python) | Django + gunicorn, settings `config.settings.render` |
| `emp-portal-web` | Static Site | The React build from `frontend/dist` |

What differs from the Azure setup (`config/settings/render.py`):

- Uploads go on a Render persistent disk, not Azure Blob Storage. Django serves them through signed links (`common/media.py`).
- The cache, which holds sign-in lockouts and rate limits, lives in a database table. There is no Redis.
- Background jobs (emails) run inside the request. There is no Celery worker.

Approximate cost: Starter web service ($7/mo) plus Basic-256MB Postgres (about $6/mo) plus a 1 GB disk (about $0.25/mo). The static site is free.

---

## 1. Push the code to a private GitHub repository

The `database/` folder and every `.env` are git-ignored, so employee data never reaches GitHub. Check `git status` before you commit.

```bash
cd emp-portal
git init -b main
git add .
git status            # database/, .env, media/, node_modules/ must NOT be listed
git commit -m "feat: add Render deployment"
git remote add origin https://github.com/<you>/emp-portal.git   # create it as PRIVATE first
git push -u origin main
```

## 2. Create the services from the Blueprint

1. Render Dashboard → **New → Blueprint**, connect GitHub, and pick the repository.
2. Render reads `render.yaml` and asks for the `sync: false` values:

| Variable | Value |
|---|---|
| `DJANGO_ALLOWED_HOSTS` | `emp-portal-api.onrender.com` |
| `CORS_ALLOWED_ORIGINS` | `https://emp-portal-web.onrender.com` |
| `FRONTEND_BASE_URL` | `https://emp-portal-web.onrender.com` |
| `VITE_API_BASE_URL` | `https://emp-portal-api.onrender.com/api/v1` |
| `EMAIL_HOST` / `EMAIL_PORT` | e.g. `smtp.gmail.com` / `587` |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | the mailbox and its App Password |
| `DEFAULT_FROM_EMAIL` | the address mail is sent from |

3. Click **Apply**. The database is created first, then both services build.

> **If Render adds a suffix to a name** (e.g. `emp-portal-api-x1y2.onrender.com`), copy the real URLs from each service's page and correct the four URL variables above. Changing `VITE_API_BASE_URL` needs a fresh build of the static site (**Manual Deploy → Deploy latest commit**), because the value is baked into the bundle.

> **The API refuses to start without SMTP.** That is deliberate (`config/settings/guards.py`): a password reset that silently goes nowhere is worse than a failed boot.

On its first start the API runs `migrate`, `createcachetable` and `seed_rbac` against the empty database. The next step replaces that empty database with your data.

## 3. Restore the database

You need `psql` 16.10 or newer (the dump uses `\restrict`). Homebrew's `postgresql@16` is fine.

1. `emp-portal-api` → **Settings → Suspend service**, so nothing holds the tables open.
2. `emp-portal-db` → **Connect → External** → copy the **External Database URL**.
3. Clear what the first start created, then restore:

```bash
export RENDER_DB='postgresql://emp_portal:...@...singapore-postgres.render.com/emp_portal'

# Render's database user owns the public schema, so DROP OWNED removes it too.
psql "$RENDER_DB" -c "DROP OWNED BY CURRENT_USER CASCADE;"
psql "$RENDER_DB" -c "CREATE SCHEMA IF NOT EXISTS public;"
gunzip -c database/emp_portal_postgres.sql.gz | psql "$RENDER_DB" -v ON_ERROR_STOP=1
```

4. `emp-portal-api` → **Resume service**. On start it runs any migrations newer than the dump and recreates the cache table, which the dump does not include.

## 4. Copy the uploaded files

Photos, documents and asset images live in `backend/media/` on your machine, and the restored database points at them. Copy them onto the disk:

1. Add your public SSH key under **Account Settings → SSH Public Keys**.
2. `emp-portal-api` → **Connect → SSH** → copy the address (`srv-...@ssh.singapore.render.com`).
3. Copy the folder contents:

```bash
scp -r backend/media/* srv-XXXX@ssh.singapore.render.com:/opt/render/project/src/backend/media/
```

Check from the service's **Shell** tab: `ls /opt/render/project/src/backend/media` should list `employee-photos`, `employee-documents` and `employee-assets`.

## 5. Check it works

- `https://emp-portal-api.onrender.com/healthz/` returns `{"status": "ok", ...}`.
- `https://emp-portal-web.onrender.com` shows the login page. Sign in with an existing account from the restored data.
- Open an employee with a photo. It should load, which shows the disk copy worked.
- Use "Forgot password" on a test account. The email should arrive, which shows SMTP works.

---

## Everyday use

- **Deploying a change:** push to `main`. Both services rebuild, and the API migrates on start.
- **Logs:** each service's **Logs** tab.
- **Backups:** paid Postgres plans take daily backups (**Recovery** tab). Back up the disk yourself with `scp` in the other direction.

## Not covered by this setup

- **Nightly token clean-up.** Celery beat does not run here. Add a Render **Cron Job** on the same repo (root dir `backend`, same environment) at `30 3 * * *` that runs `python manage.py flushexpiredtokens`.
- **Microsoft sign-in (Entra ID).** Add `ENTRA_*` to the API and `VITE_ENTRA_*` to the static site as in the `.env.example` files. Register `https://emp-portal-web.onrender.com/auth/callback` as a redirect URI.
- **Free plan.** Free web services sleep when idle and cannot have a disk, and free Postgres expires after about 30 days. Fine for a demo, not for real employee data.
