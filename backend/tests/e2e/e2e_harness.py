"""Shared machinery for the end-to-end walkthrough.

Drives the real API through Django's test client against a copy of the demo
database, signing in as each persona exactly as the SPA does.
"""

import json
import os
import pathlib
import shutil
import sys

import django

HERE = pathlib.Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
RUN_DIR = HERE / ".run"

# Work on a fresh copy of the demo database every run, so a walkthrough is
# repeatable and cannot disturb the one somebody is about to demo from.
# E2E_KEEP_DB=1 keeps the previous copy, which is what you want when poking at
# the state a failing walkthrough left behind.
RUN_DIR.mkdir(exist_ok=True)
SOURCE_DB = BACKEND / "db.sqlite3"
WORKING_DB = RUN_DIR / "e2e.sqlite3"

if os.environ.get("E2E_KEEP_DB") != "1":
    if not SOURCE_DB.exists():
        raise SystemExit(
            f"No database at {SOURCE_DB}.\n"
            "Run `python manage.py migrate && python manage.py seed_demo_data` first."
        )
    shutil.copyfile(SOURCE_DB, WORKING_DB)

sys.path.insert(0, str(HERE))
sys.path.insert(1, str(BACKEND))
# Assigned, never `setdefault`. The entire safety of these walkthroughs rests
# on running against the copy: they approve leave, process payroll and close
# accounts. Inheriting DJANGO_SETTINGS_MODULE from a parent process - which is
# exactly what a runner does - would point all of that at the real database.
os.environ["DJANGO_SETTINGS_MODULE"] = "e2e_settings"
django.setup()

from django.test.utils import setup_test_environment  # noqa: E402

# Gives us `mail.outbox`, so the walkthrough can read the reset email the
# way the recipient would.
setup_test_environment()

from django.test import Client  # noqa: E402

from apps.authentication.models import User  # noqa: E402
from apps.authentication.views import issue_token_pair  # noqa: E402

RESULTS: list[tuple[str, str, str]] = []  # (scenario, outcome, detail)
CURRENT = {"scenario": "?"}


def scenario(name: str) -> None:
    CURRENT["scenario"] = name
    print(f"\n=== {name} ===")


def check(description: str, condition: bool, detail: str = "") -> bool:
    outcome = "PASS" if condition else "FAIL"
    RESULTS.append(
        (CURRENT["scenario"], outcome, description if condition else f"{description} -- {detail}")
    )
    marker = "  ok " if condition else "  XX "
    print(f"{marker}{description}" + (f"  [{detail}]" if detail and not condition else ""))
    return condition


def note(text: str) -> None:
    print(f"     . {text}")


class Persona:
    """A signed-in user, driving the API the way the SPA does."""

    def __init__(self, email: str, label: str):
        self.email = email
        self.label = label
        self.user = User.objects.get(email=email)
        tokens = issue_token_pair(self.user)
        self.client = Client(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    def get(self, path: str, **params):
        return self.client.get(path, params or None)

    def post(self, path: str, body=None, multipart: bool = False):
        # Django's test client defaults to multipart when handed a dict, which
        # is what an upload needs; everything else goes as JSON like the SPA.
        if multipart:
            return self.client.post(path, body or {})
        return self.client.post(path, json.dumps(body or {}), content_type="application/json")

    def patch(self, path: str, body=None):
        return self.client.patch(path, json.dumps(body or {}), content_type="application/json")

    def put(self, path: str, body=None):
        return self.client.put(path, json.dumps(body or {}), content_type="application/json")

    def delete(self, path: str):
        return self.client.delete(path)

    def __repr__(self) -> str:
        return f"<{self.label}>"


def data(response):
    try:
        return response.json()
    except Exception:
        return {}


def summarise() -> int:
    failures = [row for row in RESULTS if row[1] == "FAIL"]
    print("\n" + "=" * 72)
    print(f"{len(RESULTS)} checks, {len(failures)} failed")
    if failures:
        print("-" * 72)
        for sc, _, detail in failures:
            print(f"  {sc}: {detail}")
    print("=" * 72)
    return len(failures)
