"""Project Management models.

Tables: projects, project_members, project_allocations
"""

from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum

from apps.employees.models import Department, Employee
from common.models import AuditableModel, TimeStampedModel


class Project(AuditableModel):
    """A billable or internal engagement that time is booked against."""

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=200)
    client_name = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="projects"
    )
    project_manager = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="managed_projects"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_billable = models.BooleanField(default=True)

    class Meta:
        db_table = "projects"
        ordering = ("-start_date", "code")
        indexes = [models.Index(fields=("status", "start_date"))]

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"

    @property
    def is_open(self) -> bool:
        return self.status in {self.Status.PLANNED, self.Status.ACTIVE, self.Status.ON_HOLD}

    def total_allocation(self, exclude_employee_id: int | None = None) -> Decimal:
        rows = self.allocations.filter(is_active=True)
        if exclude_employee_id:
            rows = rows.exclude(employee_id=exclude_employee_id)
        return rows.aggregate(total=Sum("allocation_percentage"))["total"] or Decimal("0")


# Module-level alias so the OpenAPI enum can be named explicitly in settings.
PROJECT_STATUS_CHOICES = Project.Status.choices


class ProjectMember(TimeStampedModel):
    """Someone on a project team, with the hat they wear on it."""

    class ProjectRole(models.TextChoices):
        MANAGER = "manager", "Project manager"
        LEAD = "lead", "Team lead"
        DEVELOPER = "developer", "Developer"
        QA = "qa", "QA"
        ANALYST = "analyst", "Business analyst"
        DESIGNER = "designer", "Designer"
        DEVOPS = "devops", "DevOps"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="project_memberships"
    )
    role_in_project = models.CharField(
        max_length=20, choices=ProjectRole.choices, default=ProjectRole.DEVELOPER
    )
    joined_on = models.DateField()
    left_on = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "project_members"
        ordering = ("project", "employee")
        constraints = [
            models.UniqueConstraint(
                fields=("project", "employee"),
                condition=models.Q(left_on__isnull=True),
                name="uniq_active_project_member",
            )
        ]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} on {self.project.code}"

    @property
    def is_active(self) -> bool:
        return self.left_on is None


class ProjectAllocation(TimeStampedModel):
    """How much of an employee's capacity a project holds.

    An employee's active allocations across all projects may not exceed 100%;
    the serializer enforces that, and timesheet entries are only accepted for
    projects the employee is allocated to.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="allocations")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="allocations")
    allocation_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01")), MaxValueValidator(Decimal("100"))],
    )
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "project_allocations"
        ordering = ("-start_date",)
        indexes = [models.Index(fields=("employee", "is_active"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.allocation_percentage}% on {self.project.code}"

    @classmethod
    def employee_total(cls, employee_id: int, exclude_pk: int | None = None) -> Decimal:
        rows = cls.objects.filter(employee_id=employee_id, is_active=True)
        if exclude_pk:
            rows = rows.exclude(pk=exclude_pk)
        return rows.aggregate(total=Sum("allocation_percentage"))["total"] or Decimal("0")
