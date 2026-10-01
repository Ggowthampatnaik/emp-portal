"""Tidies the demo organization into something fit to show an audience.

`seed_demo_data` builds the fixture. This command repairs what accumulated on
top of it by hand and during end-to-end walkthroughs: half-filled accounts
created through the UI, a display name that drifted away from its address,
test wording left in the notification feed, an empty current week on the
timesheet grid, and a payroll run dated into the future.

Idempotent, and refuses to run unless DEBUG is on - the same guard
`seed_demo_data` uses, for the same reason.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from apps.employees.models import Department, Designation, Employee
from apps.finance.models import PayslipApproval
from apps.leave_management.models import LeaveRequest
from apps.notifications.models import Notification
from apps.payroll.models import PayrollRun
from apps.projects.models import Project, ProjectAllocation, ProjectMember
from apps.timesheets.models import Timesheet, TimesheetEntry
from apps.timesheets.services import week_start
from common.enums import ApprovalStatus
from common.humanize import days_phrase, human_date, inr

User = get_user_model()

#: Accounts raised through "Add user" during testing and never completed. They
#: carry a real person's name and date of birth already; what they lack is the
#: employment record that makes them render as anything but a blank card.
#: Keyed by email so re-running is safe.
PROMOTIONS = {
    "ayansh@trigyan.io": {
        "full_name": "Ayansh Adapa",
        "department": "Engineering",
        "designation": "Software Engineer",
        "manager": "TRG0007",  # Meera Joshi, Technical Lead
        "work_location": "Hyderabad",
        "gender": "male",
        "blood_group": "B+",
        "phone": "+91 98000 10015",
    },
    "arjun@trigyan.io": {
        "full_name": "Arjun Adapa",
        "department": "Quality Assurance",
        "designation": "QA Engineer",
        "manager": "TRG0009",  # Divya Sharma, QA Lead
        "work_location": "Hyderabad",
        "gender": "male",
        "blood_group": "O+",
        "phone": "+91 98000 10016",
    },
    "rao@trigyan.io": {
        "full_name": "Rao Adapa",
        "department": "Sales",
        "designation": "Account Manager",
        "manager": "TRG0001",  # Sneha Kulkarni, Director
        "work_location": "Hyderabad",
        "gender": "male",
        "blood_group": "A+",
        "phone": "+91 98000 10017",
    },
}

#: The address is asha.rao@; the display name had drifted to "Krishna Adapa",
#: which is also a different, real account. Forty-four notifications already
#: say "Asha Rao", so correcting the profile is what makes the feed agree with
#: the directory - renaming the other way would have to rewrite all of them.
NAME_REPAIRS = {"asha.rao@trigyan.io": "Asha Rao"}


def _set_name(user, full_name: str) -> None:
    """`User.full_name` is derived, so the halves are what actually store."""
    first, _, last = full_name.partition(" ")
    if (user.first_name, user.last_name) == (first, last):
        return
    user.first_name, user.last_name = first, last
    user.save(update_fields=["first_name", "last_name"])


class Command(BaseCommand):
    help = "Repair hand-made demo records so the portal is presentable."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--keep-notifications",
            action="store_true",
            help="Leave walkthrough wording in the notification feed.",
        )

    @transaction.atomic
    def handle(self, *args, **options) -> None:
        if not settings.DEBUG:
            raise CommandError("polish_demo_data only runs with DEBUG on.")

        self._promote_accounts()
        self._repair_names()
        self._retire_orphan_accounts()
        if not options["keep_notifications"]:
            self._clean_notifications()
        self._humanize_notifications()
        self._allocate_managers()
        self._fill_current_week()
        self._realign_payroll()
        self._refresh_unpaid_payslips()

        self.stdout.write(self.style.SUCCESS("Demo data polished."))

    # ------------------------------------------------------------------ people

    def _promote_accounts(self) -> None:
        """Give the half-made accounts a department, title and reporting line."""
        changed = 0
        for email, spec in PROMOTIONS.items():
            employee = Employee.objects.filter(user__email=email).first()
            if employee is None:
                continue

            department = Department.objects.filter(name=spec["department"]).first()
            designation = Designation.objects.filter(name=spec["designation"]).first()
            manager = Employee.objects.filter(employee_code=spec["manager"]).first()
            if not (department and designation and manager):
                self.stdout.write(
                    self.style.WARNING(f"  skipped {email}: seed_demo_data has not run")
                )
                continue

            employee.department = department
            employee.designation = designation
            employee.reporting_manager = manager
            employee.work_location = spec["work_location"]
            employee.gender = spec["gender"]
            employee.blood_group = spec["blood_group"]
            employee.phone = spec["phone"]
            employee.profile_completed = True
            employee.save()

            _set_name(employee.user, spec["full_name"])
            changed += 1

        self.stdout.write(f"Promoted accounts: {changed}")

    def _repair_names(self) -> None:
        changed = 0
        for email, name in NAME_REPAIRS.items():
            user = User.objects.filter(email=email).first()
            if user and user.full_name != name:
                _set_name(user, name)
                changed += 1
        self.stdout.write(f"Names corrected: {changed}")

    def _retire_orphan_accounts(self) -> None:
        """Deactivate sign-ins with no employment record.

        `krishna@trigyan.io` can authenticate but has no Employee row and no
        roles, so every page it reaches is empty or forbidden. Deactivating
        keeps the audit trail - which deleting would not - and takes it out of
        the Administration list's active count.
        """
        orphans = User.objects.filter(employee_profile__isnull=True, is_active=True).exclude(
            is_superuser=True
        )
        names = list(orphans.values_list("email", flat=True))
        count = orphans.update(is_active=False)
        for email in names:
            self.stdout.write(f"  deactivated orphan account {email}")
        self.stdout.write(f"Orphan accounts retired: {count}")

    # ----------------------------------------------------------- notifications

    def _clean_notifications(self) -> None:
        """Remove test wording from the feed and the records behind it.

        Two sources. The walkthrough suite writes real notifications through
        the real services, so its phrasing ends up in a manager's inbox
        verbatim. And anything typed into a "Reason" box while clicking
        through the UI - `mnbvgjvgh` - is stored and shown like any other
        reason, on the dashboard, in the queue and in the notification.
        """
        stale = Notification.objects.filter(message__icontains="walkthrough")
        count = stale.count()
        stale.delete()
        self.stdout.write(f"Walkthrough notifications removed: {count}")

        # A reason with no spaces and none of the words people actually use is
        # a keyboard mash, not a sentence. Deliberately narrow: it is better to
        # leave one in than to rewrite somebody's real words.
        real_words = re.compile(
            r"\b(leave|day|off|family|sick|casual|personal|travel|wedding|medical|holiday)\b",
            re.IGNORECASE,
        )

        def is_mash(text: str) -> bool:
            value = (text or "").strip()
            return len(value) >= 4 and " " not in value and not real_words.search(value)

        replaced = 0
        for request in LeaveRequest.objects.exclude(reason=""):
            if is_mash(request.reason):
                request.reason = "Personal leave"
                request.save(update_fields=["reason"])
                replaced += 1

        dropped = 0
        for note in Notification.objects.filter(message__icontains="Reason:"):
            _, _, reason = note.message.partition("Reason:")
            if is_mash(reason):
                note.delete()
                dropped += 1

        self.stdout.write(
            f"Placeholder reasons rewritten: {replaced}, notifications dropped: {dropped}"
        )

    def _humanize_notifications(self) -> None:
        """Redress stored notifications in the copy the services now write.

        Messages are stored strings, so rows created before the humanize
        helpers keep their old wording forever unless rewritten. The
        transforms mirror the template changes: ISO dates become "3 Aug
        2026", "5.0 day(s)" becomes "5 days", bare net-pay amounts gain the
        rupee sign and Indian grouping.
        """
        iso = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
        day_s = re.compile(r"\b(\d+(?:\.\d+)?) day\(s\)")
        net_pay = re.compile(r"\b([Nn]et(?: pay:?)?) (\d+(?:\.\d{1,2})?)\b")

        def humanize(text: str) -> str:
            def iso_sub(match: re.Match) -> str:
                try:
                    return human_date(date(*map(int, match.groups())))
                except ValueError:
                    return match.group(0)

            text = iso.sub(iso_sub, text)
            text = day_s.sub(lambda m: days_phrase(m.group(1)), text)
            return net_pay.sub(lambda m: f"{m.group(1)} {inr(m.group(2))}", text)

        rewritten = 0
        for note in Notification.objects.all():
            title, message = humanize(note.title), humanize(note.message)
            if title != note.title or message != note.message:
                note.title, note.message = title, message
                note.save(update_fields=["title", "message"])
                rewritten += 1
        self.stdout.write(f"Notifications redressed in human copy: {rewritten}")

    # --------------------------------------------------------------- resourcing

    def _allocate_managers(self) -> None:
        """Put every manager on a project.

        A manager opening Timesheets to "No projects allocated to you" is a
        poor first impression of the module, and it is not representative:
        managers here bill to the projects they run.
        """
        added = 0
        for code, project_code in (("TRG0004", "PRJ-001"), ("TRG0003", "PRJ-003")):
            employee = Employee.objects.filter(employee_code=code).first()
            project = Project.objects.filter(code=project_code).first()
            if not (employee and project):
                continue

            ProjectMember.objects.get_or_create(
                project=project,
                employee=employee,
                defaults={
                    "role_in_project": ProjectMember.ProjectRole.MANAGER,
                    "joined_on": project.start_date,
                },
            )
            _, created = ProjectAllocation.objects.get_or_create(
                project=project,
                employee=employee,
                defaults={
                    "allocation_percentage": Decimal("20.00"),
                    "start_date": project.start_date,
                },
            )
            added += int(created)
        self.stdout.write(f"Manager allocations added: {added}")

    def _fill_current_week(self) -> None:
        """Book hours on the open week so the grid is not a wall of zeroes.

        Draft, not submitted: the demo is meant to show someone filling the
        week in and sending it, so the rows are there but the workflow has not
        started.
        """
        monday = week_start(timezone.localdate())
        pattern = [Decimal("8.00")] * 5 + [Decimal("0.00")] * 2
        filled = 0

        for employee in Employee.objects.filter(employment_status="active"):
            allocations = list(
                ProjectAllocation.objects.filter(employee=employee).select_related("project")
            )
            if not allocations:
                continue

            timesheet, _ = Timesheet.objects.get_or_create(
                employee=employee,
                week_start_date=monday,
                defaults={"status": ApprovalStatus.DRAFT},
            )
            # Only ever touch a week still in draft; a submitted or approved
            # sheet is somebody's record, not scratch space.
            if timesheet.status != ApprovalStatus.DRAFT:
                continue
            if timesheet.entries.exists():
                # Already booked. Make sure the stored total agrees with the
                # entries anyway, so an earlier run that saved without
                # recalculating is repaired rather than left showing 0.00.
                timesheet.recalculate_total()
                continue

            share = (Decimal("1.00") / len(allocations)).quantize(Decimal("0.01"))
            for allocation in allocations:
                for offset, hours in enumerate(pattern):
                    booked = (hours * share).quantize(Decimal("0.01"))
                    if booked <= 0:
                        continue
                    TimesheetEntry.objects.create(
                        timesheet=timesheet,
                        project=allocation.project,
                        work_date=monday + timedelta(days=offset),
                        hours=booked,
                        description="Feature work and code review.",
                    )
            # `total_hours` is a stored aggregate, not a property - the grid and
            # the dashboard's "This week" card both read it, so a plain save()
            # leaves a sheet showing 0.00 with five entries under it.
            timesheet.recalculate_total()
            filled += 1

        self.stdout.write(f"Current-week timesheets filled: {filled}")

    # ------------------------------------------------------------------ payroll

    def _realign_payroll(self) -> None:
        """Stop payroll running ahead of the calendar.

        A run for next month sitting at `paid` is the first thing a finance
        audience notices. Anything dated later than the current month is moved
        back to the most recent month that has actually finished.
        """
        today = date.today()
        future = PayrollRun.objects.filter(year__gte=today.year).order_by("year", "month")
        moved = 0

        for run in future:
            if (run.year, run.month) <= (today.year, today.month):
                continue

            # Walk back a month at a time until a free slot in the past turns up.
            year, month = today.year, today.month
            while PayrollRun.objects.filter(year=year, month=month).exclude(pk=run.pk).exists():
                month -= 1
                if month == 0:
                    year, month = year - 1, 12

            run.year, run.month = year, month
            run.save(update_fields=["year", "month"])
            moved += 1

        self.stdout.write(f"Payroll runs moved out of the future: {moved}")

    def _refresh_unpaid_payslips(self) -> None:
        """Re-derive payslip figures from the current salary structures.

        `seed_demo_data` used to scale pay by designation level alone, so every
        manager carried the identical net pay and the Finance queue read as
        placeholder data. The structures now vary per person, but payslips are
        snapshots and keep whatever they were built with.

        Only runs that have not been paid are touched, and the rows are updated
        in place rather than replaced - `PayslipApproval` points at them, and
        deleting would take the Finance queue with it. Paid runs are history
        and are left exactly as they are.
        """
        from apps.payroll.services import (
            build_payslip,
            month_bounds,
            month_working_days,
            structure_in_force,
        )

        refreshed = 0
        fields = [
            "basic",
            "hra",
            "conveyance_allowance",
            "medical_allowance",
            "special_allowance",
            "provident_fund",
            "professional_tax",
            "income_tax",
            "other_deductions",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "salary_structure",
        ]

        # A run that has been paid is history and is left alone - unless one of
        # its payslips is still sitting in the Finance queue awaiting release,
        # which means the workflow on it has not finished whatever the run says.
        # Those are on screen, and two managers at an identical net pay is the
        # first thing a finance audience notices.
        open_runs = set(
            PayslipApproval.objects.filter(
                status__in=(
                    PayslipApproval.Status.PENDING,
                    PayslipApproval.Status.PROCESSED,
                    PayslipApproval.Status.QUERIED,
                )
            ).values_list("payslip__run_id", flat=True)
        )
        runs = PayrollRun.objects.filter(
            Q(pk__in=open_runs) | ~Q(status=PayrollRun.Status.PAID)
        ).distinct()

        for run in runs:
            _, month_end = month_bounds(run.year, run.month)
            working = month_working_days(run.year, run.month)
            if working == 0:
                continue

            for payslip in run.payslips.select_related("employee").all():
                structure = structure_in_force(payslip.employee, month_end)
                if structure is None:
                    continue
                fresh = build_payslip(run, payslip.employee, structure, working)
                for field in fields:
                    setattr(payslip, field, getattr(fresh, field))
                payslip.save(update_fields=fields)
                refreshed += 1

            totals = run.payslips.aggregate(
                gross=Sum("gross_earnings"),
                deductions=Sum("total_deductions"),
                net=Sum("net_pay"),
            )
            run.total_gross = totals["gross"] or Decimal("0")
            run.total_deductions = totals["deductions"] or Decimal("0")
            run.total_net = totals["net"] or Decimal("0")
            run.save(update_fields=["total_gross", "total_deductions", "total_net"])

        self.stdout.write(f"Unpaid payslips re-derived: {refreshed}")
