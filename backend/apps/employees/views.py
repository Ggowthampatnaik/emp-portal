"""Employee Management API views."""

from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.employees.models import (
    Department,
    Designation,
    Employee,
    EmployeeSkill,
    ExperienceDetail,
    Skill,
)
from apps.employees.photo import EmployeePhotoSerializer
from apps.employees.serializers import (
    AccountDeletionCreateSerializer,
    AccountDeletionRequestSerializer,
    BankAccountSerializer,
    CompleteProfileSerializer,
    DepartmentSerializer,
    DesignationSerializer,
    EmployeeAssetSerializer,
    EmployeeCreateSerializer,
    EmployeeDetailSerializer,
    EmployeeDirectoryDetailSerializer,
    EmployeeDirectorySerializer,
    EmployeeDocumentSerializer,
    EmployeeListSerializer,
    EmployeeSearchSerializer,
    EmployeeSkillSerializer,
    EmployeeSkillSetSerializer,
    ExperienceDetailSerializer,
    ExperienceSetSerializer,
    ProfileDraftSerializer,
    SkillSerializer,
)
from apps.employees.services import (
    cancel_account_deletion,
    decode_asset_barcode,
    request_account_deletion,
)
from common.audit import record_audit
from common.enums import AuditAction, EmploymentStatus
from common.media import media_url
from common.permissions import HasModulePermission
from common.scoping import can_act_on_employee, employee_profile, scope_employees
from common.utils import payload_with


class DepartmentViewSet(viewsets.ModelViewSet):
    """Departments. Everyone may read; ``department.manage`` may write."""

    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = {
        "POST": ("department.manage",),
        "PUT": ("department.manage",),
        "PATCH": ("department.manage",),
        "DELETE": ("department.manage",),
    }
    filterset_fields = ("is_active",)
    search_fields = ("name", "code")
    ordering_fields = ("name", "code")

    def get_queryset(self):
        return Department.objects.select_related("head__user").annotate(
            employee_count=Count(
                "employees",
                filter=Q(employees__employment_status=EmploymentStatus.ACTIVE),
                distinct=True,
            )
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        record_audit(self.request, AuditAction.CREATE, instance)

    def perform_update(self, serializer):
        instance = serializer.save()
        record_audit(self.request, AuditAction.UPDATE, instance)

    def perform_destroy(self, instance):
        if instance.employees.exists():
            raise PermissionDenied(
                "This department still has employees. Reassign them before deleting it."
            )
        record_audit(self.request, AuditAction.DELETE, instance)
        instance.delete()


class DesignationViewSet(viewsets.ModelViewSet):
    """Job titles. Same permission split as departments."""

    serializer_class = DesignationSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    required_permissions = {
        "POST": ("department.manage",),
        "PUT": ("department.manage",),
        "PATCH": ("department.manage",),
        "DELETE": ("department.manage",),
    }
    filterset_fields = ("is_active", "level")
    search_fields = ("name", "code")
    ordering_fields = ("level", "name")

    def get_queryset(self):
        return Designation.objects.annotate(
            employee_count=Count(
                "employees",
                filter=Q(employees__employment_status=EmploymentStatus.ACTIVE),
                distinct=True,
            )
        )

    def perform_create(self, serializer):
        record_audit(self.request, AuditAction.CREATE, serializer.save())

    def perform_update(self, serializer):
        record_audit(self.request, AuditAction.UPDATE, serializer.save())


@extend_schema_view(
    list=extend_schema(description="Employee directory, scoped to what the caller may see."),
    retrieve=extend_schema(description="Full employee profile."),
)
class EmployeeViewSet(viewsets.ModelViewSet):
    """Employees.

    Visibility follows :mod:`common.scoping` - HR/Admin see everyone, a manager
    sees their reporting branch, an employee sees only themselves. ``/me`` is
    always available, and an employee may edit a limited set of their own fields.
    """

    permission_classes = [IsAuthenticated, HasModulePermission]
    filterset_fields = (
        "department",
        "designation",
        "employment_status",
        "reporting_manager",
        "work_location",
    )
    # The same reach as the company directory's search, so the two tabs of
    # the Employees page cannot answer the same query differently.
    search_fields = (
        "employee_code",
        "user__first_name",
        "user__last_name",
        "user__email",
        "designation__name",
        "department__name",
    )
    ordering_fields = ("employee_code", "date_of_joining", "user__first_name")
    ordering = ("employee_code",)

    SELF_EDITABLE_FIELDS = {
        "phone",
        "permanent_address",
        "current_address",
        "date_of_birth",
        "gender",
        "blood_group",
        "emergency_contact_name",
        "emergency_contact_phone",
    }

    @property
    def required_permissions(self):
        """Keyed on the action, not the HTTP verb.

        Custom actions (photo, documents) are POST/DELETE too, and they run
        their own object-level checks - gating them on employee.create here
        would stop an employee from uploading their own photo.
        """
        if self.action == "create":
            return ("employee.create",)
        if self.action in ("update", "partial_update"):
            return ()  # object-level: either employee.edit, or own record
        if self.action == "destroy":
            return ("employee.deactivate",)
        return ()

    def get_queryset(self):
        queryset = Employee.objects.select_related(
            "user", "department", "designation", "reporting_manager__user"
        ).prefetch_related(
            "user__roles"
        )  # the list rows carry roles
        if self.action in ("list", "org_chart"):
            queryset = scope_employees(queryset, self.request.user)
        if self.action == "list":
            queryset = self._exclude_self(queryset)
            queryset = self._filter_by_skills(queryset)
            # One number per row for the admin Assets page, which lists
            # everyone and shows what each of them holds. `distinct` because
            # the skills filter above joins, and a join would otherwise count
            # the same asset once per matching skill.
            queryset = queryset.annotate(asset_count=Count("assets", distinct=True))
        return queryset

    def _exclude_self(self, queryset):
        """`?exclude_self=1` drops the caller's own row from the list.

        The Employees page is where you look somebody *else* up; your own
        record is a click away under My profile, and finding yourself in a
        directory you are browsing reads as a mistake. Done here rather than in
        the SPA so the count and the pagination stay honest - filtering a page
        of results after the fact gives 24 rows on one page and 25 on the next.

        Opt-in, because the same endpoint feeds places where everybody belongs:
        the reports, the org chart and the company directory.
        """
        raw = (self.request.query_params.get("exclude_self") or "").strip().lower()
        if raw not in ("1", "true", "yes"):
            return queryset

        profile = employee_profile(self.request.user)
        return queryset.exclude(pk=profile.pk) if profile else queryset

    def _filter_by_skills(self, queryset):
        """`?skills=1,2` keeps only people who have **every** listed skill.

        Staffing asks "who knows React *and* Postgres", so the terms narrow the
        result rather than widening it. One `filter()` per skill is what forces
        the AND across rows of the join table.
        """
        raw = (self.request.query_params.get("skills") or "").strip()
        if not raw:
            return queryset

        ids = []
        for part in raw.split(","):
            part = part.strip()
            if not part.isdigit():
                raise ValidationError({"skills": ["Give skill ids as a comma-separated list."]})
            ids.append(int(part))

        for skill_id in dict.fromkeys(ids):
            queryset = queryset.filter(skills__skill_id=skill_id)
        # Each chained filter joins separately, so this cannot currently
        # duplicate rows - `distinct` is here so that stays true if the joins
        # ever change. The headcount report was inflated by exactly that.
        return queryset.distinct()

    def get_serializer_class(self):
        if self.action == "create":
            return EmployeeCreateSerializer
        if self.action == "list":
            return EmployeeListSerializer
        return EmployeeDetailSerializer

    def get_object(self):
        instance = super().get_object()
        if not can_act_on_employee(self.request.user, instance.pk):
            raise PermissionDenied("You do not have access to this employee record.")
        return instance

    # -- write paths -------------------------------------------------------
    def perform_create(self, serializer):
        instance = serializer.save()
        record_audit(
            self.request,
            AuditAction.CREATE,
            instance,
            changes={"employee_code": instance.employee_code, "email": instance.email},
        )

    def update(self, request: Request, *args, **kwargs):
        instance = self.get_object()
        is_own_record = instance.user_id == request.user.pk
        may_edit_anyone = request.user.has_module_permission("employee.edit")

        if not may_edit_anyone:
            if not is_own_record:
                raise PermissionDenied("You may only edit your own profile.")
            forbidden = set(request.data) - self.SELF_EDITABLE_FIELDS
            if forbidden:
                raise PermissionDenied(
                    "You may only change contact and personal details: "
                    + ", ".join(sorted(self.SELF_EDITABLE_FIELDS))
                )
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        before = {
            field: getattr(serializer.instance, field)
            for field in serializer.validated_data
            if hasattr(serializer.instance, field)
        }
        instance = serializer.save()
        record_audit(
            self.request,
            AuditAction.UPDATE,
            instance,
            changes={
                key: [str(value), str(getattr(instance, key, ""))] for key, value in before.items()
            },
        )

    def perform_destroy(self, instance):
        """Deactivation, not deletion - the history must survive."""
        instance.employment_status = EmploymentStatus.INACTIVE
        instance.save(update_fields=["employment_status", "updated_at"])
        instance.user.is_active = False
        instance.user.save(update_fields=["is_active", "updated_at"])
        record_audit(
            self.request, AuditAction.DELETE, instance, changes={"employment_status": "inactive"}
        )

    # -- extra routes ------------------------------------------------------
    @extend_schema(responses={200: EmployeeDetailSerializer})
    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request: Request) -> Response:
        """The caller's own employment record."""
        profile = getattr(request.user, "employee_profile", None)
        if profile is None:
            return Response(
                {
                    "error": {
                        "code": "no_employee_profile",
                        "message": (
                            "This account has no employee record yet. Ask HR to complete "
                            "your profile."
                        ),
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(self.get_serializer(profile).data)

    @extend_schema(
        responses={200: EmployeeDirectorySerializer(many=True)},
        description=(
            "Company directory: every active employee, readable by any signed-in "
            "user. Carries work contact details only - the scoped /employees/ list "
            "remains the source for full records."
        ),
    )
    @action(detail=False, methods=["get"], url_path="directory")
    def directory(self, request: Request) -> Response:
        queryset = (
            Employee.objects.filter(employment_status=EmploymentStatus.ACTIVE)
            .select_related("user", "department", "designation", "reporting_manager__user")
            .annotate(
                report_count=Count(
                    "direct_reports",
                    filter=Q(direct_reports__employment_status=EmploymentStatus.ACTIVE),
                    distinct=True,
                )
            )
            .order_by("user__first_name", "user__last_name")
        )

        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(user__first_name__icontains=search)
                | Q(user__last_name__icontains=search)
                | Q(user__email__icontains=search)
                | Q(employee_code__icontains=search)
                | Q(designation__name__icontains=search)
                | Q(department__name__icontains=search)
            )

        department = request.query_params.get("department")
        if department and department.isdigit():
            queryset = queryset.filter(department_id=int(department))

        queryset = self._filter_by_skills(queryset)

        page = self.paginate_queryset(queryset)
        serializer = EmployeeDirectorySerializer(
            page if page is not None else queryset,
            many=True,
            context=self.get_serializer_context(),
        )
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    @extend_schema(
        responses={200: EmployeeDirectoryDetailSerializer},
        description=(
            "One directory entry, expanded with the person's direct reports. "
            "Readable by any signed-in user; carries work details only."
        ),
    )
    @action(detail=False, methods=["get"], url_path=r"directory/(?P<employee_id>\d+)")
    def directory_entry(self, request: Request, employee_id: str = "") -> Response:
        employee = (
            Employee.objects.filter(pk=employee_id, employment_status=EmploymentStatus.ACTIVE)
            .select_related("user", "department", "designation", "reporting_manager__user")
            .prefetch_related("direct_reports__user", "direct_reports__designation")
            .first()
        )
        if employee is None:
            raise NotFound("No active employee with that id.")

        serializer = EmployeeDirectoryDetailSerializer(
            employee, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="Prefix of a first or last name.")],
        responses={200: EmployeeSearchSerializer(many=True)},
        description=(
            "Type-ahead over active employees, for pickers such as the leave CC "
            "field. Readable by any signed-in user and carries work details only, "
            "like the directory. Matches a **prefix** of the first or last name, "
            "or of the employee code."
        ),
    )
    @action(detail=False, methods=["get"], url_path="search")
    def search(self, request: Request) -> Response:
        term = (request.query_params.get("q") or "").strip()
        if len(term) < 2:
            # Two characters is the point at which the result set is worth
            # showing; below that it is the whole company.
            return Response([])

        matches = (
            Employee.objects.filter(employment_status=EmploymentStatus.ACTIVE)
            .filter(
                Q(user__first_name__istartswith=term)
                | Q(user__last_name__istartswith=term)
                | Q(employee_code__istartswith=term)
            )
            .select_related("user", "department", "designation")
            .order_by("user__first_name", "user__last_name")[:20]
        )
        return Response(
            EmployeeSearchSerializer(matches, many=True, context=self.get_serializer_context()).data
        )

    @extend_schema(responses={200: EmployeeListSerializer(many=True)})
    @action(detail=False, methods=["get"], url_path="my-team")
    def my_team(self, request: Request) -> Response:
        """Direct reports of the caller."""
        profile = getattr(request.user, "employee_profile", None)
        if profile is None:
            return Response([])
        reports = (
            Employee.objects.filter(reporting_manager=profile)
            .select_related("user", "department", "designation", "reporting_manager__user")
            .order_by("employee_code")
        )
        return Response(EmployeeListSerializer(reports, many=True).data)

    @extend_schema(
        description="Reporting tree for the visible population, rooted at the topmost nodes."
    )
    @action(detail=False, methods=["get"], url_path="org-chart")
    def org_chart(self, request: Request) -> Response:
        employees = list(self.get_queryset().filter(employment_status=EmploymentStatus.ACTIVE))
        by_manager: dict[int | None, list[Employee]] = {}
        for employee in employees:
            by_manager.setdefault(employee.reporting_manager_id, []).append(employee)

        visible_ids = {employee.pk for employee in employees}

        def node(employee: Employee) -> dict:
            return {
                "id": employee.pk,
                "employee_code": employee.employee_code,
                "full_name": employee.full_name,
                "designation": employee.designation.name if employee.designation_id else None,
                "department": employee.department.name if employee.department_id else None,
                # The chart is read by recognising faces before names, so the
                # photo is part of the node rather than a lookup per card.
                "photo_url": media_url(request, employee.photo),
                "reports": [node(child) for child in by_manager.get(employee.pk, [])],
            }

        roots = [
            employee
            for employee in employees
            if employee.reporting_manager_id is None
            or employee.reporting_manager_id not in visible_ids
        ]
        return Response([node(root) for root in roots])

    @extend_schema(
        request=EmployeePhotoSerializer,
        responses={200: EmployeePhotoSerializer},
        description="Upload (POST) or remove (DELETE) the profile photo.",
    )
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="photo",
        parser_classes=[MultiPartParser, FormParser],
    )
    def photo(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()

        # Your own photo, or anyone's with employee.edit.
        may_change = employee.user_id == request.user.pk or request.user.has_module_permission(
            "employee.edit"
        )
        if not may_change:
            raise PermissionDenied("You may only change your own profile photo.")

        if request.method == "DELETE":
            if employee.photo:
                employee.photo.delete(save=False)
                employee.photo = None
                employee.save(update_fields=["photo", "updated_at"])
                record_audit(request, AuditAction.UPDATE, employee, changes={"photo": "removed"})
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = EmployeePhotoSerializer(
            employee, data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        record_audit(request, AuditAction.UPDATE, employee, changes={"photo": "updated"})
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(request=EmployeeDocumentSerializer, responses={201: EmployeeDocumentSerializer})
    @action(
        detail=True,
        methods=["get", "post"],
        url_path="documents",
        parser_classes=[MultiPartParser, FormParser],
    )
    def documents(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()

        if request.method == "GET":
            serializer = EmployeeDocumentSerializer(
                employee.documents.select_related("uploaded_by"),
                many=True,
                context=self.get_serializer_context(),
            )
            return Response(serializer.data)

        may_upload = request.user.has_module_permission("employee.edit") or (
            employee.user_id == request.user.pk
        )
        if not may_upload:
            raise PermissionDenied("You may not attach documents to this record.")

        serializer = EmployeeDocumentSerializer(
            data=payload_with(request, employee=employee.pk),
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        document = serializer.save()
        record_audit(request, AuditAction.CREATE, document)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(responses={204: None})
    @action(detail=True, methods=["delete"], url_path=r"documents/(?P<document_id>\d+)")
    def delete_document(
        self, request: Request, pk: str | None = None, document_id: str = ""
    ) -> Response:
        employee = self.get_object()
        may_remove = employee.user_id == request.user.pk or request.user.has_module_permission(
            "employee.edit"
        )
        if not may_remove:
            raise PermissionDenied("You may not remove documents from this record.")
        document = employee.documents.filter(pk=document_id).first()
        if document is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        record_audit(request, AuditAction.DELETE, document)
        document.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # -- bank details (F10) ------------------------------------------------
    def _may_touch_bank_details(self, employee: Employee) -> bool:
        """Decision D9: the employee and HR only - never the reporting manager.

        `get_object` has already let a manager through on their own branch, so
        this check is what actually keeps bank details away from them.
        """
        return employee.user_id == self.request.user.pk or self.request.user.has_module_permission(
            "bank.manage"
        )

    @extend_schema(
        request=BankAccountSerializer,
        responses={200: BankAccountSerializer},
        description=(
            "Salary bank account. GET returns the masked number to everyone; the "
            "full number is included only when the owner reads their own record. "
            "Readable and writable by the employee and by HR (`bank.manage`) - "
            "reporting managers are excluded."
        ),
    )
    @action(detail=True, methods=["get", "put", "delete"], url_path="bank-account")
    def bank_account(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()
        is_owner = employee.user_id == request.user.pk
        if not self._may_touch_bank_details(employee):
            raise PermissionDenied("Bank details are visible to the employee and HR only.")

        account = getattr(employee, "bank_account", None)
        context = {**self.get_serializer_context(), "is_owner": is_owner}

        if request.method == "GET":
            if account is None:
                raise NotFound("No bank account has been recorded for this employee.")
            return Response(BankAccountSerializer(account, context=context).data)

        if request.method == "DELETE":
            if account is not None:
                record_audit(
                    request,
                    AuditAction.DELETE,
                    account,
                    changes={"account_number": account.masked_account_number},
                )
                account.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = BankAccountSerializer(account, data=request.data, context=context)
        serializer.is_valid(raise_exception=True)
        saved = serializer.save(employee=employee, updated_by=request.user)
        if account is None:
            saved.created_by = request.user
            saved.save(update_fields=["created_by", "updated_at"])

        # Never write the account number itself to the audit log - the masked
        # form is enough to prove which account a change moved money to.
        record_audit(
            request,
            AuditAction.CREATE if account is None else AuditAction.UPDATE,
            saved,
            changes={
                "employee": employee.employee_code,
                "bank_name": saved.bank_name,
                "ifsc_code": saved.ifsc_code,
                "account_number": saved.masked_account_number,
            },
        )
        return Response(
            BankAccountSerializer(saved, context=context).data,
            status=status.HTTP_201_CREATED if account is None else status.HTTP_200_OK,
        )

    # -- first login (F18) -------------------------------------------------
    @extend_schema(
        request=CompleteProfileSerializer,
        responses={200: EmployeeDetailSerializer},
        description=(
            "The Complete Profile step a new employee must finish before the "
            "portal opens (decision D11). Every field is mandatory; the flag "
            "flips only when all of them are present."
        ),
    )
    @extend_schema(
        request=ProfileDraftSerializer,
        responses={200: EmployeeDetailSerializer},
        description="Saves however much of the profile form exists so far, without submitting it.",
    )
    @action(detail=True, methods=["post"], url_path="profile-draft")
    def profile_draft(self, request: Request, pk: str | None = None) -> Response:
        """Half a profile, kept for later.

        Deliberately never sets ``profile_completed`` - the gate stays shut
        until the person comes back and submits the whole thing.
        """
        employee = self.get_object()
        if employee.user_id != request.user.pk:
            raise PermissionDenied("You can only draft your own profile.")

        serializer = ProfileDraftSerializer(employee, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        saved = serializer.save()
        return Response(EmployeeDetailSerializer(saved, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="complete-profile")
    def complete_profile(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()
        if employee.user_id != request.user.pk:
            raise PermissionDenied("You can only complete your own profile.")

        serializer = CompleteProfileSerializer(employee, data=request.data, partial=False)
        serializer.is_valid(raise_exception=True)
        saved = serializer.save()

        if not saved.profile_completed:
            saved.profile_completed = True
            saved.save(update_fields=["profile_completed", "updated_at"])
            record_audit(
                request,
                AuditAction.UPDATE,
                saved,
                changes={"profile_completed": True},
            )

        return Response(EmployeeDetailSerializer(saved, context=self.get_serializer_context()).data)

    @extend_schema(
        request=ExperienceSetSerializer,
        responses={200: ExperienceDetailSerializer(many=True)},
        description="Previous employment. PUT replaces the whole history.",
    )
    @action(detail=True, methods=["get", "put"], url_path="experience")
    def experience(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()
        current = employee.experience_details.all()

        if request.method == "GET":
            return Response(ExperienceDetailSerializer(current, many=True).data)

        may_edit = employee.user_id == request.user.pk or request.user.has_module_permission(
            "employee.edit"
        )
        if not may_edit:
            raise PermissionDenied("You may only change your own experience details.")

        serializer = ExperienceSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            employee.experience_details.all().delete()
            ExperienceDetail.objects.bulk_create(
                [
                    ExperienceDetail(employee=employee, **row)
                    for row in serializer.validated_data["experience"]
                ]
            )
        return Response(
            ExperienceDetailSerializer(employee.experience_details.all(), many=True).data
        )

    # -- account closure ---------------------------------------------------
    @extend_schema(
        request=AccountDeletionCreateSerializer,
        responses={201: AccountDeletionRequestSerializer},
        description=(
            "Ask for this account to be closed. HR raises it; an administrator "
            "decides (`employee.approve_deletion`). Approving **deactivates** - "
            "nothing is deleted, and the person's leave, timesheets and payslips "
            "are untouched. GET returns the most recent request, so the button "
            "can show what is already in flight; DELETE withdraws an open one."
        ),
    )
    @action(detail=True, methods=["get", "post", "delete"], url_path="deletion-request")
    def deletion_request(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()

        if request.method == "GET":
            latest = employee.deletion_requests.select_related(
                "requested_by", "decided_by", "employee__user"
            ).first()
            if latest is None:
                raise NotFound("No closure request has been raised for this employee.")
            return Response(AccountDeletionRequestSerializer(latest).data)

        if not request.user.has_module_permission("employee.request_deletion"):
            raise PermissionDenied("You do not have permission to request account closure.")

        if request.method == "DELETE":
            open_request = employee.deletion_requests.filter(status="pending").first()
            if open_request is None:
                raise NotFound("There is no open closure request to withdraw.")
            withdrawn = cancel_account_deletion(open_request.pk, request.user)
            record_audit(
                request,
                AuditAction.UPDATE,
                withdrawn,
                changes={"status": "cancelled", "employee": employee.employee_code},
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = AccountDeletionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        created = request_account_deletion(
            employee, request.user, serializer.validated_data["reason"]
        )
        record_audit(
            request,
            AuditAction.SUBMIT,
            created,
            changes={"employee": employee.employee_code, "reason": created.reason},
        )
        return Response(
            AccountDeletionRequestSerializer(created).data, status=status.HTTP_201_CREATED
        )

    # -- skills (F12) ------------------------------------------------------
    @extend_schema(
        request=EmployeeSkillSetSerializer,
        responses={200: EmployeeSkillSerializer(many=True)},
        description=(
            "The employee's skills. PUT replaces the whole set, which is how the "
            "editor works - add, change and remove are one save."
        ),
    )
    @action(detail=True, methods=["get", "put"], url_path="skills")
    def skills(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()
        current = employee.skills.select_related("skill")

        if request.method == "GET":
            return Response(EmployeeSkillSerializer(current, many=True).data)

        may_edit = employee.user_id == request.user.pk or request.user.has_module_permission(
            "employee.edit"
        )
        if not may_edit:
            raise PermissionDenied("You may only change your own skills.")

        serializer = EmployeeSkillSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rows = serializer.validated_data["skills"]

        before = sorted(row.skill.name for row in current)
        with transaction.atomic():
            employee.skills.all().delete()
            EmployeeSkill.objects.bulk_create(
                [
                    EmployeeSkill(
                        employee=employee,
                        skill=row["skill"],
                        proficiency=row["proficiency"],
                        years_of_experience=row.get("years_of_experience"),
                    )
                    for row in rows
                ]
            )

        after = sorted(row["skill"].name for row in rows)
        if before != after:
            record_audit(request, AuditAction.UPDATE, employee, changes={"skills": [before, after]})
        return Response(
            EmployeeSkillSerializer(employee.skills.select_related("skill"), many=True).data
        )

    # -- company assets ----------------------------------------------------
    # Reading follows the visibility of the record itself: get_object has
    # already decided whether this caller may see this employee, so their kit
    # is visible on the same terms - an employee sees their own, a manager
    # their team's, HR and Admin everyone's. Writing is narrower, because
    # issuing kit is a custody decision rather than a profile edit: only
    # asset.manage, which is HR and Admin.
    def _may_manage_assets(self) -> bool:
        return self.request.user.has_module_permission("asset.manage")

    @extend_schema(
        request=EmployeeAssetSerializer,
        responses={200: EmployeeAssetSerializer(many=True), 201: EmployeeAssetSerializer},
        description="List the assets issued to this employee (GET) or issue one (POST).",
    )
    @action(
        detail=True,
        methods=["get", "post"],
        url_path="assets",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def assets(self, request: Request, pk: str | None = None) -> Response:
        employee = self.get_object()

        if request.method == "GET":
            return Response(
                EmployeeAssetSerializer(
                    employee.assets.all(), many=True, context=self.get_serializer_context()
                ).data
            )

        if not self._may_manage_assets():
            raise PermissionDenied("You may not issue assets.")

        data, barcode_serial = self._with_barcode_serial(request)
        serializer = EmployeeAssetSerializer(data=data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        asset = serializer.save(employee=employee)
        record_audit(request, AuditAction.CREATE, asset)
        return Response(
            {**serializer.data, "barcode_serial": barcode_serial},
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _with_barcode_serial(request: Request) -> tuple[dict, str | None]:
        """Fills ``serial_number`` from the photo's barcode when HR left it out.

        HR photographs the label on the back of the kit and the sticker's own
        barcode supplies the asset number. A serial typed into the form always
        wins - the human said something specific - so the decoded value steps
        in only where the field arrived empty. The decoded text rides back on
        the response as ``barcode_serial`` so the UI can say what was read.
        """
        payload = payload_with(request)
        decoded = decode_asset_barcode(request.FILES.get("photo"))
        if decoded and not str(payload.get("serial_number") or "").strip():
            payload["serial_number"] = decoded
        return payload, decoded

    @extend_schema(
        request=EmployeeAssetSerializer,
        responses={200: EmployeeAssetSerializer, 204: None},
        description="Amend (PATCH) or return/write off (DELETE) one issued asset.",
    )
    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"assets/(?P<asset_id>\d+)",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def asset_detail(self, request: Request, pk: str | None = None, asset_id: str = "") -> Response:
        employee = self.get_object()
        if not self._may_manage_assets():
            raise PermissionDenied("You may not change the assets issued to this employee.")

        asset = employee.assets.filter(pk=asset_id).first()
        if asset is None:
            raise NotFound("No such asset is issued to this employee.")

        if request.method == "DELETE":
            record_audit(request, AuditAction.DELETE, asset)
            # The photo is the row's own file; nothing else points at it.
            if asset.photo:
                asset.photo.delete(save=False)
            asset.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        data, barcode_serial = self._with_barcode_serial(request)
        serializer = EmployeeAssetSerializer(
            asset, data=data, partial=True, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        record_audit(request, AuditAction.UPDATE, asset)
        return Response({**serializer.data, "barcode_serial": barcode_serial})


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Type-ahead match on the skill name."),
            OpenApiParameter("category", str, description="One of the Skill categories."),
        ],
        description="The controlled skill vocabulary, used by the filters and the profile editor.",
    )
)
class SkillViewSet(viewsets.ModelViewSet):
    """The skill vocabulary.

    Everyone signed in may read it - the autocomplete on the employee filters
    and on the profile editor both need it. Only HR may change it, so the list
    stays a vocabulary rather than free text (decision D10).
    """

    serializer_class = SkillSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    ordering = ("name",)

    @property
    def required_permissions(self):
        if self.action in ("list", "retrieve"):
            return ()
        return ("skill.manage",)

    def get_queryset(self):
        queryset = Skill.objects.annotate(employee_count=Count("employees", distinct=True))
        if self.action == "list":
            # Retired skills stay readable by id so existing profiles still render.
            if self.request.query_params.get("include_inactive") != "true":
                queryset = queryset.filter(is_active=True)
            term = (self.request.query_params.get("q") or "").strip()
            if term:
                queryset = queryset.filter(name__icontains=term)
            category = (self.request.query_params.get("category") or "").strip()
            if category:
                queryset = queryset.filter(category=category)
        return queryset

    def perform_create(self, serializer):
        skill = serializer.save()
        record_audit(self.request, AuditAction.CREATE, skill, changes={"name": skill.name})

    def perform_update(self, serializer):
        skill = serializer.save()
        record_audit(self.request, AuditAction.UPDATE, skill, changes={"name": skill.name})

    def perform_destroy(self, instance):
        """Retire rather than delete - existing profiles must keep their history."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        record_audit(self.request, AuditAction.UPDATE, instance, changes={"is_active": False})
