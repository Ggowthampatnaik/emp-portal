"""Run the end-to-end walkthroughs.

    python manage.py e2e                 # all of them
    python manage.py e2e hr assets       # only walkthroughs whose name matches
    python manage.py e2e --verbose       # show every check, not just failures

Each walkthrough signs in as real accounts and drives the real API through the
whole of a job somebody actually does - a new joiner registering, HR working
the second stage of a leave request, Finance releasing payslips - and asserts
what should and should not be possible at each step.

They run against a throwaway copy of `db.sqlite3`, so they can approve leave
and process payroll without touching the database you demo from.

Each one is a separate process on purpose: they configure Django themselves,
against their own settings, and sharing one interpreter would let state from an
earlier walkthrough decide the outcome of a later one.
"""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

WALKTHROUGHS = Path(__file__).resolve().parents[3] / "tests" / "e2e"
TOTAL = re.compile(r"(\d+) checks, (\d+) failed")


class Command(BaseCommand):
    help = "Run the end-to-end walkthroughs against a copy of the demo database."

    def add_arguments(self, parser):
        parser.add_argument(
            "only",
            nargs="*",
            help="Substrings of walkthrough names to run. Omit to run all of them.",
        )
        parser.add_argument(
            "--verbose",
            action="store_true",
            help="Print every check, not just the failures.",
        )
        parser.add_argument(
            "--keep-db",
            action="store_true",
            help="Reuse the previous working database instead of copying a fresh one.",
        )

    def handle(self, *args, **options):
        if not WALKTHROUGHS.is_dir():
            raise CommandError(f"No walkthroughs at {WALKTHROUGHS}")

        scripts = sorted(WALKTHROUGHS.glob("e2e_[0-9]*.py"))
        wanted = options["only"]
        if wanted:
            scripts = [s for s in scripts if any(term.lower() in s.stem.lower() for term in wanted)]
            if not scripts:
                available = ", ".join(s.stem for s in sorted(WALKTHROUGHS.glob("e2e_*.py")))
                raise CommandError(f"Nothing matches {wanted!r}. Available: {available}")

        # The child settings module is set here, not inherited: this command is
        # itself run under `config.settings.dev`, and passing that down would
        # point the walkthroughs at the database they exist to stay away from.
        child_env = {**os.environ, "DJANGO_SETTINGS_MODULE": "e2e_settings"}
        if options["keep_db"]:
            child_env["E2E_KEEP_DB"] = "1"
        checks = failed = 0
        broken: list[str] = []
        started = time.monotonic()

        self.stdout.write("")
        for script in scripts:
            name = script.stem.replace("e2e_", "")
            result = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True,
                text=True,
                cwd=str(WALKTHROUGHS),
                env=child_env,
                encoding="utf-8",
                errors="replace",
            )
            output = (result.stdout or "") + (result.stderr or "")
            match = TOTAL.search(output)

            if match is None:
                # It did not get far enough to report - a crash, not a failure.
                broken.append(name)
                self.stdout.write(self.style.ERROR(f"  {name:<22} DID NOT RUN"))
                tail = output.strip().splitlines()[-12:]
                self.stdout.write("".join(f"      {line}\n" for line in tail))
                continue

            ran, bad = int(match.group(1)), int(match.group(2))
            checks += ran
            failed += bad

            line = f"  {name:<22} {ran:>3} checks"
            if bad:
                self.stdout.write(self.style.ERROR(f"{line}, {bad} FAILED"))
                for failure in [ln for ln in output.splitlines() if ln.startswith("  XX ")]:
                    self.stdout.write(self.style.ERROR(f"      {failure.strip()}"))
            else:
                self.stdout.write(self.style.SUCCESS(line))

            if options["verbose"]:
                self.stdout.write("".join(f"      {ln}\n" for ln in output.splitlines()))

        elapsed = time.monotonic() - started
        self.stdout.write("")
        summary = f"{len(scripts)} walkthroughs, {checks} checks, {failed} failed  ({elapsed:.0f}s)"

        if failed or broken:
            if broken:
                summary += f"; {len(broken)} did not run: {', '.join(broken)}"
            self.stdout.write(self.style.ERROR(summary))
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS(summary))
