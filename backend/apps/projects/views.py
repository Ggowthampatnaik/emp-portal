"""Project Management API views."""

from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.projects.models import Project, ProjectAllocation
from apps.projects.serializers import (
    ProjectAllocationSerializer,
    ProjectDetailSerializer,
    ProjectListSerializer,
    ProjectMemberSerializer,
)
from common.audit import record_audit
from common.enums import AuditAction
from common.permissions import HasModulePermission
from common.scoping import employee_profile
from common.utils import payload_with


class ProjectViewSet(viewsets.ModelViewSet):
    """Projects.

    An employee sees the projects they are a member of; anyone with
    ``project.view_all`` sees the portfolio. Writes need ``project.manage``,
    team changes need ``project.assign_team``, allocations ``project.allocate``.
    """

    permission_classes = [IsAuthenticated, HasModulePermission]
    filterset_fields = ("status", "department", "project_manager", "is_billable")
    search_fields = ("code", "name", "client_name")
    ordering_fields = ("code", "name", "start_date", "status")
    ordering = ("-start_date",)

    @property
    def required_permissions(self):
        """Keyed on the action, not the HTTP verb.

        The team and allocation routes are POST/PATCH/DELETE too, and they run
        their own `_require` check for `project.assign_team` /
        `project.allocate`. Gating them here on `project.manage` locked out the
        very people those permissions exist for: a manager staffing their own
        project, and HR moving somebody between teams.
        """
        writing = self.request.method not in ("GET", "HEAD", "OPTIONS")

        if self.action in ("members", "member_detail"):
            return ("project.assign_team",) if writing else ("project.view",)
        if self.action in ("allocations", "allocation_detail"):
            return ("project.allocate",) if writing else ("project.view",)
        if self.action in ("create", "update", "partial_update", "destroy"):
            return ("project.manage",)
        return ("project.view",)

    queryset = Project.objects.none()  # schema generation only

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        queryset = (
            Project.objects.select_related("department", "project_manager__user")
            .annotate(
                member_count=Count(
                    "members", filter=Q(members__left_on__isnull=True), distinct=True
                )
            )
            .prefetch_related(
                "members__employee__user",
                "members__employee__designation",
                "allocations__employee__user",
                "allocations__project",
            )
        )

        user = self.request.user
        if user.has_module_permission("project.view_all"):
            return queryset

        profile = employee_profile(user)
        if profile is None:
            return queryset.none()
        return queryset.filter(Q(members__employee=profile) | Q(project_manager=profile)).distinct()

    def get_serializer_class(self):
        return ProjectListSerializer if self.action == "list" else ProjectDetailSerializer

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        record_audit(self.request, AuditAction.CREATE, instance)

    def perform_update(self, serializer):
        instance = serializer.save(updated_by=self.request.user)
        record_audit(self.request, AuditAction.UPDATE, instance)

    def perform_destroy(self, instance):
        """Projects are cancelled, not deleted - timesheet history references them."""
        instance.status = Project.Status.CANCELLED
        instance.save(update_fields=["status", "updated_at"])
        record_audit(self.request, AuditAction.DELETE, instance, changes={"status": "cancelled"})

    # -- team --------------------------------------------------------------
    @extend_schema(responses={200: ProjectMemberSerializer(many=True)})
    @action(detail=True, methods=["get", "post"], url_path="members")
    def members(self, request: Request, pk: str | None = None) -> Response:
        project = self.get_object()

        if request.method == "GET":
            rows = project.members.select_related("employee__user", "employee__designation")
            return Response(ProjectMemberSerializer(rows, many=True).data)

        self._require("project.assign_team")
        serializer = ProjectMemberSerializer(data=payload_with(request, project=project.pk))
        serializer.is_valid(raise_exception=True)
        member = serializer.save()
        record_audit(request, AuditAction.CREATE, member)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(responses={200: ProjectMemberSerializer})
    @action(detail=True, methods=["patch", "delete"], url_path=r"members/(?P<member_id>\d+)")
    def member_detail(
        self, request: Request, pk: str | None = None, member_id: str = ""
    ) -> Response:
        project = self.get_object()
        self._require("project.assign_team")

        member = project.members.filter(pk=member_id).first()
        if member is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == "DELETE":
            record_audit(request, AuditAction.DELETE, member)
            member.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = ProjectMemberSerializer(member, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        record_audit(request, AuditAction.UPDATE, serializer.save())
        return Response(serializer.data)

    # -- allocations -------------------------------------------------------
    @extend_schema(responses={200: ProjectAllocationSerializer(many=True)})
    @action(detail=True, methods=["get", "post"], url_path="allocations")
    def allocations(self, request: Request, pk: str | None = None) -> Response:
        project = self.get_object()

        if request.method == "GET":
            rows = project.allocations.select_related("employee__user", "project")
            return Response(ProjectAllocationSerializer(rows, many=True).data)

        self._require("project.allocate")
        serializer = ProjectAllocationSerializer(data=payload_with(request, project=project.pk))
        serializer.is_valid(raise_exception=True)
        allocation = serializer.save()
        record_audit(
            request,
            AuditAction.CREATE,
            allocation,
            changes={"allocation_percentage": str(allocation.allocation_percentage)},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(responses={200: ProjectAllocationSerializer})
    @action(
        detail=True, methods=["patch", "delete"], url_path=r"allocations/(?P<allocation_id>\d+)"
    )
    def allocation_detail(
        self, request: Request, pk: str | None = None, allocation_id: str = ""
    ) -> Response:
        project = self.get_object()
        self._require("project.allocate")

        allocation = project.allocations.filter(pk=allocation_id).first()
        if allocation is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == "DELETE":
            record_audit(request, AuditAction.DELETE, allocation)
            allocation.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = ProjectAllocationSerializer(allocation, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        record_audit(request, AuditAction.UPDATE, serializer.save())
        return Response(serializer.data)

    def _require(self, code: str) -> None:
        from rest_framework.exceptions import PermissionDenied

        if not self.request.user.has_module_permission(code):
            raise PermissionDenied(f"This action requires the '{code}' permission.")


class MyAllocationViewSet(viewsets.ReadOnlyModelViewSet):
    """``/my-allocations/`` - what the signed-in employee is booked on.

    Backs the timesheet project picker: only allocated projects may be booked.
    """

    serializer_class = ProjectAllocationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        profile = employee_profile(self.request.user)
        if profile is None:
            return ProjectAllocation.objects.none()
        return (
            ProjectAllocation.objects.filter(employee=profile, is_active=True)
            .select_related("project", "employee__user")
            .order_by("project__code")
        )
