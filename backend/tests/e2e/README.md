# End-to-end walkthroughs

Fifteen scripts that sign in as real demo accounts and drive the real API
through the whole of a job somebody actually does — a new joiner registering,
HR working the second stage of a leave request, Finance releasing payslips —
asserting at each step what should and should not be possible.

```bash
python manage.py e2e                # all of them
python manage.py e2e hr assets      # only walkthroughs whose name matches
python manage.py e2e --verbose      # every check, not just the failures
python manage.py e2e --keep-db      # reuse the working copy, to inspect a failure
```

## How they differ from the pytest suite

`pytest` checks pieces in isolation against a fresh in-memory database. These
check the *seams* between pieces against the demo data, as a person meets them:
does the sidebar a role sees match what the API lets them do, does a permission
that exists actually reach an endpoint, does a workflow leave the right thing
behind.

That is what they have caught: a `project.assign_team` permission no endpoint
consulted, so nobody could staff a project; HR holding no `project.view_all`,
so their Projects page was silently empty; certificate uploads accepting a PNG
renamed `.pdf`.

## The database

They run against a **throwaway copy** of `db.sqlite3`, made fresh at the start
of each script and kept in `.run/`. They approve leave, process payroll and
close accounts — none of which you want happening to the database you are about
to demo from.

That isolation rests on one line in `e2e_harness.py`:

```python
os.environ["DJANGO_SETTINGS_MODULE"] = "e2e_settings"
```

Assigned, never `setdefault`. It was `setdefault` once, and a runner that passed
its own settings module down the process tree pointed every walkthrough at the
real database — which duly deactivated three employees and invented four
accounts before anyone noticed. If you write another runner, set that variable
explicitly.

## Writing one

`e2e_harness` gives you `Persona` (a signed-in user driving the API the way the
SPA does), `scenario`, `check`, `note` and `summarise`. A script ends with:

```python
raise SystemExit(summarise())
```

so its exit code is the number of failed checks, and the runner can total them.

Name it `e2e_NN_subject.py`. The number sets the running order; the `e2e_`
prefix is what keeps pytest from trying to import it, and the root `conftest.py`
says so a second time with `collect_ignore_glob`.

Do not put a `conftest.py` in this directory. Adding one puts it on `sys.path`
for the whole run, and the three test modules that do `from conftest import
PASSWORD` then import *this* one instead of the root fixtures.

Two rules learned the hard way:

- **Assert on what you put there, not on totals.** `count == 1` breaks the first
  time somebody uses the feature for real; `"MY-SERIAL" in serials` does not.
- **Do not assume a pristine database.** Anything you create, create with a
  distinctive marker so a later run can tell it apart.
