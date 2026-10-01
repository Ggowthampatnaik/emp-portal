"""One-off demo data clean-up for the 7 Sep 2026 demo. Run once with:

    python manage.py shell < tools_demo_cleanup.py

Uses the same services the portal uses, so balances, audit rows and
notifications stay consistent. Idempotent: anything already done is skipped.
"""

from datetime import date, timedelta

from django.db import transaction

from apps.authentication.models import User
from apps.employees.models import Employee
from apps.leave_management import services as leave
from apps.leave_management.models import LeaveRequest, LeaveType
from apps.notifications.models import Notification
from apps.payroll.models import PayrollRun
from apps.payroll.services import mark_paid
from apps.projects.models import ProjectAllocation
from apps.timesheets import services as ts

today = date.today()
by_email = lambda e: User.objects.get(email=e)  # noqa: E731
priya, vikram, sneha, rahul, asha, karthik = (
    by_email(e)
    for e in (
        "priya.menon@trigyan.io",
        "vikram.nair@trigyan.io",
        "sneha.kulkarni@trigyan.io",
        "rahul.iyer@trigyan.io",
        "asha.rao@trigyan.io",
        "karthik.reddy@trigyan.io",
    )
)


def note(msg):
    print(f"  - {msg}")


print("Leave requests")
with transaction.atomic():
    r = LeaveRequest.objects.filter(pk=11).first()
    if r and r.status == "pending_hr":
        r.manager_comment = "Cover arranged with Karthik for both days."
        r.decision_comment = r.manager_comment
        r.save(update_fields=["manager_comment", "decision_comment"])
        leave.hr_approve(11, actor=priya, comment="Confirmed.")
        note("#11 Asha CL 26-27 Aug: junk comment replaced, HR approved")
    r = LeaveRequest.objects.filter(pk=23).first()
    if r and r.status == "pending_manager":
        leave.manager_approve(23, actor=vikram, comment="Fine by me.")
        leave.hr_approve(23, actor=priya, comment="Confirmed.")
        note("#23 Asha CL 28 Aug: approved through both stages")
    r = LeaveRequest.objects.filter(pk=24).first()
    if r and r.status == "pending_manager":
        leave.cancel_leave(24, actor=priya, comment="Not needed after all.")
        note("#24 Priya CL 26 Aug: cancelled by the applicant")

    # A fresh request in Vikram's queue so the manager demo has two rows.
    start = today + timedelta(days=7)
    while start.weekday() != 3:  # a Thursday, one working day
        start += timedelta(days=1)
    kar_emp = Employee.objects.get(user=karthik)
    if not LeaveRequest.objects.filter(employee=kar_emp, start_date=start).exists():
        sl = LeaveType.objects.get(code="SL")
        leave.apply_for_leave(
            employee=kar_emp,
            leave_type=sl,
            start=start,
            end=start,
            day_part=LeaveRequest.DayPart.FULL,
            reason="Dentist appointment in the morning; will be back online after lunch.",
            contact_number="+91 98000 06006",
        )
        note(f"Karthik SL {start}: applied, waiting on Vikram")

print("Timesheets for the last completed week")
last_week = ts.last_completed_week(today)
approvers = {}
with transaction.atomic():
    for emp in Employee.objects.filter(employment_status="active").select_related("user"):
        projects = list(
            ProjectAllocation.objects.filter(employee=emp)
            .values_list("project_id", "allocation_percentage")
            .order_by("-allocation_percentage")
        )
        if not projects:
            continue
        # Leave two people outstanding so HR's "Notify" has something to do.
        if emp.user.email in ("suresh.kumar@trigyan.io", "nikhil.verma@trigyan.io"):
            continue
        sheet = ts.get_or_create_timesheet(emp, last_week)
        if sheet.status != "draft":
            continue
        total = sum(int(p[1]) for p in projects) or 100
        rows = []
        for day in range(5):
            work_date = last_week + timedelta(days=day)
            for project_id, pct in projects:
                hours = round(8 * int(pct) / total * 4) / 4
                if hours <= 0:
                    continue
                rows.append(
                    {
                        "project": project_id,
                        "work_date": work_date,
                        "hours": hours,
                        "description": "Sprint work, reviews and stand-ups.",
                        "is_billable": True,
                    }
                )
        try:
            ts.save_entries(sheet, rows)
            ts.submit_timesheet(sheet.pk, actor=emp.user)
            approver = ts.approver_for(emp)
            if approver is not None:
                ts.approve_timesheet(sheet.pk, actor=approver, comment="")
                note(f"{emp.full_name}: submitted and approved by {approver.get_full_name()}")
            else:
                note(f"{emp.full_name}: submitted (no approver)")
        except Exception as exc:  # keep going; report what did not fit
            note(f"{emp.full_name}: skipped ({exc})")

print("Accounts")
u = User.objects.filter(email="krishna@trigyan.io").first()
if u and not Employee.objects.filter(user=u).exists():
    u.delete()
    note("krishna@trigyan.io removed (no employment record, no payslips)")

print("Payroll runs")
for run in PayrollRun.objects.filter(year=2025, status="approved"):
    with transaction.atomic():
        mark_paid(run.pk, actor=rahul)
    note(f"{run.period_label}: marked paid")

print("Notifications")
n, _ = Notification.objects.filter(title__icontains="September 2026").delete()
note(f"{n} 'Payslip for September 2026' notifications removed")
print("done")
