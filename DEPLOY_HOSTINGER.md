# Deploying the Trigyan Employee Portal on Hostinger

## Which Hostinger plan

The portal's backend is a **Python (Django) application**. Hostinger's shared
and Cloud web hosting plans run PHP sites and cannot keep a Python app
running, so the backend needs a **Hostinger VPS** (KVM 1 or larger,
Ubuntu 24.04). The database can be MySQL on the same VPS, or a MySQL database
created in hPanel.

## What is in this package

| Path | What it is |
| --- | --- |
| `database/emp_portal.sql.gz` | The portal's data as a MySQL dump (56 tables, utf8mb4, MariaDB-compatible) |
| `backend/` | The Django API. Settings for this server: `config/settings/hostinger.py` |
| `backend/.env.hostinger.example` | Every setting the server needs - copy to `backend/.env` |
| `backend/media/` | Uploaded photos and documents |
| `frontend/dist/` | The built website, ready to serve |
| `frontend/` (rest) | Frontend source, only needed to rebuild |

Not included on purpose: `.env` files with local secrets, `node_modules`,
the Python virtualenv, the local SQLite database, logs and backups.

All demo accounts keep their password `Portal@123`. **Change them, or create
real accounts and deactivate these, before real employees use the portal.**

## 1. Prepare the VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-dev build-essential pkg-config \
    default-libmysqlclient-dev nginx mysql-server unzip certbot python3-certbot-nginx
```

Upload the zip (hPanel file manager, or `scp`) and unpack it:

```bash
sudo mkdir -p /srv/emp-portal && sudo chown $USER /srv/emp-portal
unzip trigyan-portal-hostinger.zip -d /srv/emp-portal
cd /srv/emp-portal
```

## 2. Database

Create the database and a user (skip if you made them in hPanel):

```bash
sudo mysql -e "CREATE DATABASE emp_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'emp_portal'@'localhost' IDENTIFIED BY 'CHOOSE-A-STRONG-PASSWORD';
GRANT ALL PRIVILEGES ON emp_portal.* TO 'emp_portal'@'localhost'; FLUSH PRIVILEGES;"
```

Import the data:

```bash
gunzip -c database/emp_portal.sql.gz | mysql -u emp_portal -p emp_portal
```

Using hPanel instead: **Databases -> phpMyAdmin -> select the database ->
Import**, and choose `emp_portal.sql.gz` (phpMyAdmin reads `.gz` directly).

## 3. Backend

```bash
cd /srv/emp-portal/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements/hostinger.txt
cp .env.hostinger.example .env
nano .env        # fill in every value - see the comments in the file
.venv/bin/python manage.py migrate          # nothing to apply after the import; confirms the connection
.venv/bin/python manage.py createcachetable # already in the dump; harmless to repeat
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py check --deploy
```

Run it as a service - `/etc/systemd/system/emp-portal.service`:

```ini
[Unit]
Description=Trigyan Employee Portal API
After=network.target mysql.service

[Service]
User=www-data
WorkingDirectory=/srv/emp-portal/backend
EnvironmentFile=/srv/emp-portal/backend/.env
ExecStart=/srv/emp-portal/backend/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 3 --timeout 60
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /srv/emp-portal/backend/media
sudo systemctl daemon-reload && sudo systemctl enable --now emp-portal
curl -s http://127.0.0.1:8000/healthz/     # should report "ok"
```

## 4. Website and HTTPS (Nginx)

`/etc/nginx/sites-available/emp-portal` - replace `portal.example.com`:

```nginx
server {
    listen 80;
    server_name portal.example.com;
    client_max_body_size 10m;

    root /srv/emp-portal/frontend/dist;
    index index.html;

    location ~ ^/(api|media|static|healthz)/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The portal is a single-page app: every other path is index.html.
    location / {
        try_files $uri /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/emp-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d portal.example.com     # free HTTPS certificate
```

Point the domain at the VPS first: in hPanel, **Domains -> DNS** -> an `A`
record for `portal` with the VPS IP address.

## 5. Check it

Open `https://portal.example.com`, sign in as `priya.menon@trigyan.io` /
`Portal@123`, and open Leave, Timesheets and Payslip.

## Updating later

Upload the new code, then:

```bash
cd /srv/emp-portal/backend
.venv/bin/pip install -r requirements/hostinger.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
sudo systemctl restart emp-portal
```

Back the database up first: `mysqldump -u emp_portal -p emp_portal | gzip > backup-$(date +%F).sql.gz`.

## Differences from the Azure setup

- Uploaded files are stored in `backend/media/` on the VPS, not Azure Blob
  Storage. Include that folder in your backups.
- There is no Redis: login lockouts and rate limits use a database table, and
  emails are sent during the request rather than by a background worker.
- MySQL cannot enforce two "only one open record" rules at the database level
  (one pending account-closure request per employee; one active membership per
  project). The application already checks both before saving.
