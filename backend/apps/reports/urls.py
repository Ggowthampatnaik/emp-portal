from django.urls import path

from apps.reports import views

app_name = "reports"

urlpatterns = [
    path("dashboard/summary/", views.DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("dashboard/birthdays/", views.BirthdayCalendarView.as_view(), name="dashboard-birthdays"),
    path("reports/employees/", views.EmployeeReportView.as_view(), name="report-employees"),
    path("reports/leave/", views.LeaveReportView.as_view(), name="report-leave"),
    path("reports/timesheet/", views.TimesheetReportView.as_view(), name="report-timesheet"),
    path("reports/projects/", views.ProjectReportView.as_view(), name="report-projects"),
]
