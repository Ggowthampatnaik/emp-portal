"""Employee Management serializers."""

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from apps.authentication.models import Role
from apps.employees.models import (
    MANDATORY_PROFILE_FIELDS,
    AccountDeletionRequest,
    BankAccount,
    Department,
    Designation,
    Employee,
    EmployeeAsset,
    EmployeeDocument,
    EmployeeSkill,
    ExperienceDetail,
    Skill,
)
from apps.employees.photo import ALLOWED_CONTENT_TYPES as ALLOWED_PHOTO_TYPES
from apps.employees.photo import MAX_PHOTO_BYTES
from common.enums import EmploymentStatus, RoleSlug
from common.media import media_url

#: Certificates and letters are text; anything larger is a scan nobody needs
#: at that resolution, and storage is per-tenant.
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

User = get_user_model()


class DepartmentSerializer(serializers.ModelSerializer):
    head_name = serializers.CharField(source="head.full_name", read_only=True, default=None)
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = (
            "id",
            "code",
            "name",
            "description",
            "head",
            "head_name",
            "is_active",
            "employee_count",
        )


class DesignationSerializer(serializers.ModelSerializer):
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Designation
        fields = ("id", "code", "name", "level", "description", "is_active", "employee_count")


class EmployeeListSerializer(serializers.ModelSerializer):
    """Flat shape for the directory grid - no nested objects, one query."""

    full_name = serializers.CharField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, default=None
    )
    reporting_manager_name = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    asset_count = serializers.SerializerMethodField()
    #: The portal account behind this employment record, and what it may do -
    #: here so the directory's Change-role control needs no second request.
    user_id = serializers.IntegerField(read_only=True)
    roles = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = (
            "id",
            "employee_code",
            "full_name",
            "email",
            "photo_url",
            "department",
            "department_name",
            "designation",
            "designation_name",
            "reporting_manager",
            "reporting_manager_name",
            "date_of_joining",
            "employment_status",
            "user_id",
            "roles",
            "work_location",
            "phone",
            "asset_count",
        )

    def get_reporting_manager_name(self, obj: Employee) -> str | None:
        return obj.reporting_manager.full_name if obj.reporting_manager_id else None

    def get_roles(self, obj) -> list[str]:
        if not obj.user_id:
            return []
        return sorted(role.slug for role in obj.user.roles.all())

    def get_asset_count(self, obj: Employee) -> int | None:
        """How many assets this person holds.

        Annotated by the list queryset. ``my_team`` reuses this serializer
        without that annotation, and ``None`` says "not counted here" rather
        than claiming a zero nobody measured.
        """
        return getattr(obj, "asset_count", None)

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)


class EmployeeDirectorySerializer(serializers.ModelSerializer):
    """The company directory: who works here and how to reach them at work.

    Deliberately narrow. Everything personal - phone, date of birth, addresses,
    blood group, salary-adjacent fields - is excluded, because unlike the
    scoped employee record this list is readable by every signed-in user.
    """

    full_name = serializers.CharField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, default=None
    )
    reporting_manager_name = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()

    reporting_manager = serializers.PrimaryKeyRelatedField(read_only=True)
    direct_report_count = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = (
            "id",
            "employee_code",
            "full_name",
            "email",
            "department_name",
            "designation_name",
            "reporting_manager",
            "reporting_manager_name",
            "direct_report_count",
            "date_of_joining",
            "work_location",
            "photo_url",
        )
        read_only_fields = fields

    def get_reporting_manager_name(self, obj: Employee) -> str | None:
        return obj.reporting_manager.full_name if obj.reporting_manager_id else None

    def get_direct_report_count(self, obj: Employee) -> int:
        # Annotated by the view where it matters; falls back to a query so the
        # serializer is safe to use on its own.
        annotated = getattr(obj, "report_count", None)
        return annotated if annotated is not None else obj.direct_reports.count()

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)


class DirectReportSerializer(serializers.ModelSerializer):
    """A single row in someone's list of direct reports."""

    full_name = serializers.CharField(read_only=True)
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, default=None
    )
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ("id", "employee_code", "full_name", "designation_name", "photo_url")
        read_only_fields = fields

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)


class EmployeeSearchSerializer(serializers.ModelSerializer):
    """Type-ahead row: enough to recognise someone and address them.

    Carries `user` as well as `id` because the things that pick people - leave
    CC, for one - are addressed to the portal account, not to the employment
    record.
    """

    user_id = serializers.IntegerField(source="user.pk", read_only=True)
    full_name = serializers.CharField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, default=None
    )
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = (
            "id",
            "user_id",
            "employee_code",
            "full_name",
            "email",
            "designation_name",
            "department_name",
            "photo_url",
        )
        read_only_fields = fields

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)


class EmployeeDirectoryDetailSerializer(EmployeeDirectorySerializer):
    """One directory card, expanded: the same fields plus who reports to them."""

    direct_reports = serializers.SerializerMethodField()

    class Meta(EmployeeDirectorySerializer.Meta):
        fields = (*EmployeeDirectorySerializer.Meta.fields, "direct_reports")
        read_only_fields = fields

    def get_direct_reports(self, obj: Employee) -> list[dict]:
        reports = (
            obj.direct_reports.filter(employment_status=EmploymentStatus.ACTIVE)
            .select_related("user", "designation")
            .order_by("user__first_name", "user__last_name")
        )
        return DirectReportSerializer(reports, many=True, context=self.context).data


class EmployeeDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(
        source="uploaded_by.full_name", read_only=True, default=None
    )
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeDocument
        fields = (
            "id",
            "employee",
            "document_type",
            "title",
            "file",
            "file_url",
            "file_size",
            "content_type",
            "uploaded_by_name",
            "created_at",
        )
        read_only_fields = ("file_size", "content_type", "uploaded_by_name", "created_at")
        extra_kwargs = {"file": {"write_only": True}}

    def validate_title(self, value: str) -> str:
        title = value.strip()
        if not title:
            raise serializers.ValidationError("Give the document a name.")
        return title

    def validate_file(self, value):
        """PDF only, and small enough to be a document rather than a scan dump.

        The extension and the browser-supplied content type are both worth
        checking for a clear early message, but neither is evidence: a caller
        posting straight at the API picks both. The first five bytes are the
        part that cannot be renamed - every PDF starts ``%PDF-``.
        """
        if value.size > MAX_DOCUMENT_BYTES:
            raise serializers.ValidationError(
                f"The file must be under {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB; "
                f"this one is {value.size / (1024 * 1024):.1f} MB."
            )

        name = (getattr(value, "name", "") or "").lower()
        if not name.endswith(".pdf"):
            raise serializers.ValidationError("Upload the document as a PDF.")

        try:
            head = value.read(5)
        finally:
            # Whatever happens, hand the file back rewound or it saves empty.
            value.seek(0)
        if head != b"%PDF-":
            raise serializers.ValidationError(
                "That file is not a PDF, whatever it is named. Export or scan it as a PDF."
            )
        return value

    def get_file_url(self, obj: EmployeeDocument) -> str | None:
        if not obj.file:
            return None
        return media_url(self.context.get("request"), obj.file)

    def create(self, validated_data: dict) -> EmployeeDocument:
        uploaded = validated_data["file"]
        validated_data["file_size"] = getattr(uploaded, "size", 0)
        validated_data["content_type"] = getattr(uploaded, "content_type", "") or ""
        validated_data["uploaded_by"] = self.context["request"].user
        return super().create(validated_data)


class EmployeeAssetSerializer(serializers.ModelSerializer):
    """Company kit issued to one employee.

    The photo travels in as multipart and back out as a URL, the same shape the
    profile photo uses, so the SPA has one thing to render rather than two.
    """

    photo_url = serializers.SerializerMethodField()
    # Declared rather than inferred so DRF does not attach its own uniqueness
    # validator: that one fires first and reports "must be unique", which is
    # exactly the message validate_serial_number below exists to improve on.
    serial_number = serializers.CharField(max_length=100)

    class Meta:
        model = EmployeeAsset
        fields = (
            "id",
            "employee",
            "name",
            "brand",
            "serial_number",
            "photo",
            "photo_url",
            "issued_on",
            "condition",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("employee", "created_at", "updated_at")
        extra_kwargs = {
            "photo": {"write_only": True, "required": False, "allow_null": True},
        }

    def get_photo_url(self, obj: EmployeeAsset) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)

    def validate_photo(self, value):
        """Same limits as a profile photo - it is the same kind of upload."""
        if value in (None, ""):
            return value
        if value.size > MAX_PHOTO_BYTES:
            raise serializers.ValidationError(
                f"The photo must be under {MAX_PHOTO_BYTES // (1024 * 1024)} MB; "
                f"this one is {value.size / (1024 * 1024):.1f} MB."
            )
        content_type = getattr(value, "content_type", "")
        if content_type and content_type not in ALLOWED_PHOTO_TYPES:
            raise serializers.ValidationError("Upload a JPEG, PNG or WebP image.")
        return value

    def validate_serial_number(self, value: str) -> str:
        """Says *who* already holds it.

        "This field must be unique" sends whoever is entering it hunting
        through the whole company. Only asset.manage reaches this, and that is
        HR and Admin, who can see the holder's record anyway.
        """
        serial = value.strip().upper()
        if not serial:
            raise serializers.ValidationError("Enter the serial number printed on the device.")

        clash = EmployeeAsset.objects.filter(serial_number=serial)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        holder = clash.select_related("employee__user").first()
        if holder is not None:
            raise serializers.ValidationError(
                f"Serial number {serial} is already recorded against "
                f"{holder.employee.employee_code} ({holder.employee.full_name}). "
                "Move that record rather than adding a second one."
            )
        return serial

    def update(self, instance: EmployeeAsset, validated_data: dict) -> EmployeeAsset:
        """Replaces the photo, deleting the file it displaces."""
        previous = instance.photo if "photo" in validated_data else None
        asset = super().update(instance, validated_data)
        if previous and previous != asset.photo:
            previous.delete(save=False)
        return asset


class EmployeeDetailSerializer(serializers.ModelSerializer):
    """Full profile, including the nested user identity and documents."""

    full_name = serializers.CharField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name")
    roles = serializers.SerializerMethodField()
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    designation_name = serializers.CharField(
        source="designation.name", read_only=True, default=None
    )
    reporting_manager_name = serializers.SerializerMethodField()
    direct_report_count = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    documents = EmployeeDocumentSerializer(many=True, read_only=True)

    class Meta:
        model = Employee
        fields = (
            "id",
            "employee_code",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "roles",
            "department",
            "department_name",
            "designation",
            "designation_name",
            "reporting_manager",
            "reporting_manager_name",
            "direct_report_count",
            "date_of_joining",
            "date_of_exit",
            "employment_status",
            "phone",
            "date_of_birth",
            "gender",
            "blood_group",
            "photo_url",
            "permanent_address",
            "current_address",
            "emergency_contact_name",
            "emergency_contact_phone",
            "work_location",
            "profile_completed",
            "documents",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at", "photo_url", "profile_completed")

    def get_roles(self, obj: Employee) -> list[str]:
        return sorted(obj.user.role_slugs)

    def get_reporting_manager_name(self, obj: Employee) -> str | None:
        return obj.reporting_manager.full_name if obj.reporting_manager_id else None

    def get_direct_report_count(self, obj: Employee) -> int:
        return obj.direct_reports.count()

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)

    def validate_reporting_manager(self, value):
        if value and self.instance and value.pk == self.instance.pk:
            raise serializers.ValidationError("An employee cannot report to themselves.")
        if value and self.instance and value.pk in self.instance.descendant_ids():
            raise serializers.ValidationError(
                "That would create a cycle: the chosen manager reports to this employee."
            )
        return value

    @transaction.atomic
    def update(self, instance: Employee, validated_data: dict) -> Employee:
        user_data = validated_data.pop("user", {})
        if user_data:
            for field, value in user_data.items():
                setattr(instance.user, field, value)
            instance.user.save(update_fields=[*user_data.keys(), "updated_at"])

        request = self.context.get("request")
        if request is not None:
            instance.updated_by = request.user
        return super().update(instance, validated_data)


class EmployeeCreateSerializer(serializers.ModelSerializer):
    """Creates the portal account and the employment record together.

    HR sets a temporary password; ``must_change_password`` forces a reset on
    first sign-in.
    """

    # These live on the User, not the Employee, so they are write-only here and
    # the response is rendered by EmployeeDetailSerializer instead.
    first_name = serializers.CharField(max_length=100, write_only=True)
    last_name = serializers.CharField(max_length=100, write_only=True)
    email = serializers.EmailField(write_only=True)
    temporary_password = serializers.CharField(write_only=True, min_length=8)
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=RoleSlug.choices),
        required=False,
        default=list,
        write_only=True,
        help_text="Additional roles; every employee gets the base employee role.",
    )

    class Meta:
        model = Employee
        fields = (
            "id",
            "employee_code",
            "first_name",
            "last_name",
            "email",
            "temporary_password",
            "roles",
            "department",
            "designation",
            "reporting_manager",
            "date_of_joining",
            "employment_status",
            "phone",
            "date_of_birth",
            "gender",
            "blood_group",
            "permanent_address",
            "current_address",
            "work_location",
            "emergency_contact_name",
            "emergency_contact_phone",
        )

    def validate_email(self, value: str) -> str:
        value = value.lower().strip()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_roles(self, value: list[str]) -> list[str]:
        # Onboarding may hand out the working roles, never the oversight one.
        # Super Admin is granted from Administration, by a Super Admin, so that
        # `employee.create` alone can never mint an account that bypasses every
        # permission check.
        if RoleSlug.SUPER_ADMIN.value in value:
            raise serializers.ValidationError(
                "Super Admin cannot be assigned during onboarding. "
                "A Super Admin grants it from Administration."
            )
        return sorted(set(value))

    def validate_employee_code(self, value: str) -> str:
        value = value.upper().strip()
        if Employee.objects.filter(employee_code=value).exists():
            raise serializers.ValidationError("This employee code is already in use.")
        return value

    @transaction.atomic
    def create(self, validated_data: dict) -> Employee:
        first_name = validated_data.pop("first_name")
        last_name = validated_data.pop("last_name")
        email = validated_data.pop("email")
        password = validated_data.pop("temporary_password")
        role_slugs = set(validated_data.pop("roles", [])) | {RoleSlug.EMPLOYEE.value}

        user = User.objects.create_user(
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        user.must_change_password = True
        user.save(update_fields=["must_change_password"])

        for role in Role.objects.filter(slug__in=role_slugs):
            user.user_roles.create(role=role, assigned_by=self.context["request"].user)

        request = self.context.get("request")
        return Employee.objects.create(
            user=user,
            created_by=request.user if request else None,
            updated_by=request.user if request else None,
            **validated_data,
        )

    def to_representation(self, instance: Employee) -> dict:
        """Echo the created record in the same shape as GET /employees/{id}/."""
        return EmployeeDetailSerializer(instance, context=self.context).data


class OrgNodeSerializer(serializers.Serializer):
    """One node of the reporting tree; ``reports`` nests the same shape."""

    id = serializers.IntegerField()
    employee_code = serializers.CharField()
    full_name = serializers.CharField()
    designation = serializers.CharField(allow_null=True)
    department = serializers.CharField(allow_null=True)
    reports = serializers.ListField(child=serializers.DictField(), default=list)


class SkillSerializer(serializers.ModelSerializer):
    """A vocabulary term. ``employee_count`` is annotated by the list view."""

    category_label = serializers.CharField(source="get_category_display", read_only=True)
    employee_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Skill
        fields = ("id", "name", "category", "category_label", "is_active", "employee_count")

    def validate_name(self, value: str) -> str:
        """Case-insensitive uniqueness - "React" and "react" are one skill."""
        name = value.strip()
        clashes = Skill.objects.filter(name__iexact=name)
        if self.instance:
            clashes = clashes.exclude(pk=self.instance.pk)
        if clashes.exists():
            raise serializers.ValidationError(f"{name} is already in the skill list.")
        return name


class EmployeeSkillSerializer(serializers.ModelSerializer):
    skill_name = serializers.CharField(source="skill.name", read_only=True)
    skill_category = serializers.CharField(source="skill.category", read_only=True)

    class Meta:
        model = EmployeeSkill
        fields = (
            "id",
            "skill",
            "skill_name",
            "skill_category",
            "proficiency",
            "years_of_experience",
        )


class EmployeeSkillWriteSerializer(serializers.Serializer):
    """One row of the "my skills" editor; the whole set is saved at once."""

    skill = serializers.PrimaryKeyRelatedField(queryset=Skill.objects.filter(is_active=True))
    proficiency = serializers.ChoiceField(
        choices=EmployeeSkill.Proficiency.choices,
        default=EmployeeSkill.Proficiency.INTERMEDIATE,
    )
    years_of_experience = serializers.DecimalField(
        max_digits=4, decimal_places=1, required=False, allow_null=True, min_value=0
    )


class EmployeeSkillSetSerializer(serializers.Serializer):
    skills = EmployeeSkillWriteSerializer(many=True)

    def validate_skills(self, value: list[dict]) -> list[dict]:
        seen = [row["skill"].pk for row in value]
        if len(seen) != len(set(seen)):
            raise serializers.ValidationError("The same skill is listed twice.")
        return value


class BankAccountSerializer(serializers.ModelSerializer):
    """Bank details.

    ``account_number`` is write-only. Reads get ``account_number_masked``
    always, and ``account_number`` only when the owner is looking at their own
    record (decision D9) - HR can maintain the details without being able to
    read them back out of a support screen.
    """

    account_number = serializers.CharField(write_only=True, max_length=34, min_length=6)
    # Declared without the model's validator so a lower-case code can be
    # upper-cased first; field validators would otherwise run before we get it.
    ifsc_code = serializers.CharField(max_length=11)
    account_number_masked = serializers.CharField(source="masked_account_number", read_only=True)
    account_type_label = serializers.CharField(source="get_account_type_display", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    updated_by_name = serializers.CharField(
        source="updated_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = BankAccount
        fields = (
            "id",
            "employee_code",
            "account_holder_name",
            "bank_name",
            "branch_name",
            "account_number",
            "account_number_masked",
            "ifsc_code",
            "account_type",
            "account_type_label",
            "updated_by_name",
            "updated_at",
        )
        read_only_fields = ("updated_at",)

    def validate_ifsc_code(self, value: str) -> str:
        code = value.upper().strip()
        BankAccount.IFSC_VALIDATOR(code)
        return code

    def validate_account_number(self, value: str) -> str:
        number = value.strip()
        if not number.isalnum():
            raise serializers.ValidationError("Use digits and letters only, with no spaces.")
        return number

    def to_representation(self, instance: BankAccount) -> dict:
        data = super().to_representation(instance)
        if self.context.get("is_owner"):
            data["account_number"] = instance.account_number
        return data


class AccountDeletionRequestSerializer(serializers.ModelSerializer):
    """A closure request, as both HR and the deciding administrator see it."""

    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee.email", read_only=True)
    department_name = serializers.CharField(
        source="employee.department.name", read_only=True, default=None
    )
    designation_name = serializers.CharField(
        source="employee.designation.name", read_only=True, default=None
    )
    employment_status = serializers.CharField(source="employee.employment_status", read_only=True)
    requested_by_name = serializers.CharField(
        source="requested_by.full_name", read_only=True, default=None
    )
    decided_by_name = serializers.CharField(
        source="decided_by.full_name", read_only=True, default=None
    )
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = AccountDeletionRequest
        fields = (
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "employee_email",
            "department_name",
            "designation_name",
            "employment_status",
            "reason",
            "status",
            "is_open",
            "requested_by",
            "requested_by_name",
            "requested_at",
            "decided_by_name",
            "decided_at",
            "decision_note",
        )
        read_only_fields = fields


class AccountDeletionCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=10, max_length=1000)


class AccountDeletionDecisionSerializer(serializers.Serializer):
    """Approve carries an optional note; reject requires one (see the service)."""

    note = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")


class ExperienceDetailSerializer(serializers.ModelSerializer):
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = ExperienceDetail
        fields = (
            "id",
            "company_name",
            "job_title",
            "from_date",
            "to_date",
            "description",
            "is_current",
        )

    def validate(self, attrs: dict) -> dict:
        start = attrs.get("from_date")
        end = attrs.get("to_date")
        if start and end and end < start:
            raise serializers.ValidationError(
                {"to_date": ["The end date cannot precede the start date."]}
            )
        return attrs


class ExperienceSetSerializer(serializers.Serializer):
    """The whole history is saved at once, like the skills editor."""

    experience = ExperienceDetailSerializer(many=True)


class ProfileDraftSerializer(serializers.ModelSerializer):
    """A partial save of the complete-profile form.

    Somebody filling the wizard has to be able to leave halfway without losing
    what they typed - so every field is optional and the completed flag is
    never touched here. What *is* typed still has to be valid: a draft that
    saved a phone number the final submit would reject helps nobody.
    """

    class Meta:
        model = Employee
        fields = MANDATORY_PROFILE_FIELDS
        extra_kwargs = {name: {"required": False} for name in MANDATORY_PROFILE_FIELDS}


class CompleteProfileSerializer(serializers.ModelSerializer):
    """The first thing a new employee ever fills in (F18).

    Every field here is mandatory: the flag flips only when the whole set is
    present, so "complete" means the same thing to the gate as it does to the
    person filling the form. Anything optional - skills, education documents,
    experience - belongs on My Profile afterwards, not in the way of getting in.
    """

    class Meta:
        model = Employee
        fields = MANDATORY_PROFILE_FIELDS

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            field.required = True
            field.allow_blank = getattr(field, "allow_blank", None) and False
            if name == "date_of_birth":
                field.allow_null = False

    def validate(self, attrs: dict) -> dict:
        missing = [name for name in MANDATORY_PROFILE_FIELDS if not attrs.get(name)]
        if missing:
            raise serializers.ValidationError(
                {name: ["This is needed before the portal opens."] for name in missing}
            )
        return attrs
