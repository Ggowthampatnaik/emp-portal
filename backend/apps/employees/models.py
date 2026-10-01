"""Employee Management models.

Tables: departments, designations, employees, employee_documents,
employee_bank_accounts, skills, employee_skills
"""

from django.conf import settings
from django.core.validators import MinLengthValidator, RegexValidator
from django.db import models

from common.enums import EmploymentStatus
from common.models import AuditableModel, TimeStampedModel


class Department(TimeStampedModel):
    """An organizational unit. ``head`` is the employee accountable for it."""

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    head = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_departments",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "departments"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Designation(TimeStampedModel):
    """A job title, with a level used for ordering and reporting."""

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=120, unique=True)
    level = models.PositiveSmallIntegerField(
        default=1, help_text="1 = most junior; used for sorting and org reports."
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "designations"
        ordering = ("level", "name")

    def __str__(self) -> str:
        return self.name


class Employee(AuditableModel):
    """The employment record behind a portal user."""

    class Gender(models.TextChoices):
        FEMALE = "female", "Female"
        MALE = "male", "Male"
        OTHER = "other", "Other"
        UNDISCLOSED = "undisclosed", "Prefer not to say"

    class BloodGroup(models.TextChoices):
        A_POSITIVE = "A+", "A+"
        A_NEGATIVE = "A-", "A-"
        B_POSITIVE = "B+", "B+"
        B_NEGATIVE = "B-", "B-"
        AB_POSITIVE = "AB+", "AB+"
        AB_NEGATIVE = "AB-", "AB-"
        O_POSITIVE = "O+", "O+"
        O_NEGATIVE = "O-", "O-"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
    )
    employee_code = models.CharField(
        max_length=20,
        unique=True,
        validators=[MinLengthValidator(3)],
        help_text="Payroll identifier, e.g. TRG0042.",
    )
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    designation = models.ForeignKey(
        Designation, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees"
    )
    reporting_manager = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="direct_reports"
    )

    date_of_joining = models.DateField()
    date_of_exit = models.DateField(null=True, blank=True)
    employment_status = models.CharField(
        max_length=20, choices=EmploymentStatus.choices, default=EmploymentStatus.ACTIVE
    )

    phone = models.CharField(
        max_length=20,
        blank=True,
        validators=[RegexValidator(r"^[0-9+\-\s()]{6,20}$", "Enter a valid phone number.")],
    )
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=15, choices=Gender.choices, blank=True)
    blood_group = models.CharField(
        max_length=3,
        choices=BloodGroup.choices,
        blank=True,
        help_text="Kept for emergency contact purposes only.",
    )
    photo = models.ImageField(
        upload_to="employee-photos/%Y/%m/",
        blank=True,
        null=True,
        help_text="Profile photo; stored in Azure Blob Storage in deployed environments.",
    )
    permanent_address = models.TextField(
        blank=True, help_text="Home address of record, used for statutory paperwork."
    )
    current_address = models.TextField(
        blank=True,
        help_text="Where the employee lives now, when it differs from the permanent one.",
    )
    emergency_contact_name = models.CharField(max_length=120, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)
    work_location = models.CharField(max_length=120, blank=True)

    profile_completed = models.BooleanField(
        default=False,
        help_text=(
            "False until the employee has filled in the Complete Profile page. "
            "Until then the portal is closed to them - see MANDATORY_PROFILE_FIELDS."
        ),
    )

    class Meta:
        db_table = "employees"
        ordering = ("employee_code",)
        indexes = [
            models.Index(fields=("department", "employment_status")),
            models.Index(fields=("reporting_manager",)),
        ]

    def __str__(self) -> str:
        return f"{self.employee_code} - {self.full_name}"

    # -- convenience -------------------------------------------------------
    @property
    def full_name(self) -> str:
        return self.user.full_name

    @property
    def email(self) -> str:
        return self.user.email

    @property
    def is_active(self) -> bool:
        return self.employment_status == EmploymentStatus.ACTIVE

    def descendant_ids(self) -> set[int]:
        """Every employee below this one in the reporting tree.

        Used by manager-scoped querysets so a manager sees their whole branch,
        not only immediate reports.
        """
        seen: set[int] = set()
        frontier = [self.pk]
        while frontier:
            children = list(
                Employee.objects.filter(reporting_manager_id__in=frontier)
                .exclude(pk__in=seen)
                .values_list("pk", flat=True)
            )
            if not children:
                break
            seen.update(children)
            frontier = children
        return seen


class EmployeeDocument(TimeStampedModel):
    """A file attached to an employee record, stored in Azure Blob Storage."""

    class DocumentType(models.TextChoices):
        ID_PROOF = "id_proof", "ID proof"
        ADDRESS_PROOF = "address_proof", "Address proof"
        # Education, itemised: "certificate" was one bucket for four different
        # things people are asked for separately.
        TENTH = "tenth", "10th certificate"
        INTERMEDIATE = "intermediate", "12th / intermediate certificate"
        BACHELORS = "bachelors", "Bachelor's degree"
        MASTERS = "masters", "Master's degree"
        OTHER_EDUCATION = "other_education", "Other education certificate"
        SKILL_CERTIFICATE = "skill_certificate", "Skills certification"
        EDUCATION = "education", "Education certificate"
        EXPERIENCE_LETTER = "experience_letter", "Experience letter"
        EXPERIENCE = "experience", "Experience letter (legacy)"
        CONTRACT = "contract", "Employment contract"
        OTHER = "other", "Other"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="documents")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    title = models.CharField(max_length=200)
    file = models.FileField(upload_to="employee-documents/%Y/%m/")
    file_size = models.PositiveIntegerField(default=0)
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "employee_documents"
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.title} ({self.employee.employee_code})"


class BankAccount(AuditableModel):
    """Where an employee's salary is paid.

    One row per employee. The account number is *never* returned in full to
    anyone but the owner (see the serializers) and never written to the audit
    log - a fraud target should not leak through a support screen or a log
    export.
    """

    IFSC_VALIDATOR = RegexValidator(
        r"^[A-Z]{4}0[A-Z0-9]{6}$",
        "Enter a valid IFSC code: four letters, a zero, then six letters or digits.",
    )

    class AccountType(models.TextChoices):
        SAVINGS = "savings", "Savings"
        CURRENT = "current", "Current"
        SALARY = "salary", "Salary"

    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="bank_account")
    account_holder_name = models.CharField(
        max_length=120, help_text="Exactly as printed on the passbook."
    )
    bank_name = models.CharField(max_length=120)
    branch_name = models.CharField(max_length=120, blank=True)
    account_number = models.CharField(
        max_length=34,
        validators=[MinLengthValidator(6)],
        help_text="Up to 34 characters, so international accounts also fit.",
    )
    ifsc_code = models.CharField(max_length=11, validators=[IFSC_VALIDATOR])
    account_type = models.CharField(
        max_length=10, choices=AccountType.choices, default=AccountType.SAVINGS
    )

    class Meta:
        db_table = "employee_bank_accounts"
        ordering = ("employee__employee_code",)

    def __str__(self) -> str:
        return f"{self.employee.employee_code} - {self.bank_name} {self.masked_account_number}"

    @property
    def masked_account_number(self) -> str:
        """The last four digits only, e.g. ``XXXXXX7788``."""
        tail = self.account_number[-4:]
        return f"{'X' * max(len(self.account_number) - 4, 0)}{tail}"

    def save(self, *args, **kwargs):
        # Bank codes are case-insensitive in practice but stored upper-case, so
        # the IFSC validator has one shape to check.
        self.ifsc_code = self.ifsc_code.upper().strip()
        self.account_number = self.account_number.strip()
        return super().save(*args, **kwargs)


class EmployeeAsset(AuditableModel):
    """A piece of company kit issued to an employee - laptop, phone, monitor.

    Serial numbers are unique across the company. The same physical device
    cannot be out with two people at once, so a duplicate is nearly always the
    same item recorded twice rather than two items that happen to share a
    serial. Reissuing to somebody else is an edit of the row - moving the
    employee - not a second row.

    The photo is optional on purpose: kit is often handed over before anyone
    gets round to photographing it, and a record without a picture is still
    worth having.
    """

    class Condition(models.TextChoices):
        NEW = "new", "New"
        GOOD = "good", "Good"
        FAIR = "fair", "Fair"
        NEEDS_REPAIR = "needs_repair", "Needs repair"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="assets")
    name = models.CharField(max_length=120, help_text='What it is, e.g. "MacBook Pro 14".')
    brand = models.CharField(max_length=80, help_text='Who made it, e.g. "Apple".')
    serial_number = models.CharField(
        max_length=100,
        unique=True,
        help_text="As printed on the device. Stored upper-case.",
    )
    photo = models.ImageField(
        upload_to="employee-assets/%Y/%m/",
        blank=True,
        null=True,
        help_text="Optional; stored in Azure Blob Storage in deployed environments.",
    )
    # Nullable, not defaulted: rows issued before this field existed have no
    # recorded date, and a guessed one would read as fact on the detail card.
    issued_on = models.DateField(blank=True, null=True, help_text="When the kit was handed over.")
    condition = models.CharField(
        max_length=20,
        choices=Condition.choices,
        default=Condition.GOOD,
        help_text="State of the kit when last recorded.",
    )

    class Meta:
        db_table = "employee_assets"
        ordering = ("name", "serial_number")

    def __str__(self) -> str:
        return f"{self.name} ({self.serial_number})"

    def save(self, *args, **kwargs):
        # Serials get quoted inconsistently. Trimmed and upper-cased so a stray
        # space or a lower-case letter cannot slip a duplicate past the
        # uniqueness constraint.
        self.serial_number = self.serial_number.strip().upper()
        self.name = self.name.strip()
        self.brand = self.brand.strip()
        return super().save(*args, **kwargs)


class Skill(TimeStampedModel):
    """A controlled vocabulary term (decision D10), extendable by HR.

    Free text would fragment the same skill across spellings, which defeats the
    filter this exists for.
    """

    class Category(models.TextChoices):
        LANGUAGE = "language", "Programming language"
        FRAMEWORK = "framework", "Framework or library"
        DATABASE = "database", "Database"
        CLOUD = "cloud", "Cloud and DevOps"
        TOOL = "tool", "Tool"
        DOMAIN = "domain", "Domain knowledge"
        SOFT = "soft", "Professional skill"
        OTHER = "other", "Other"

    name = models.CharField(max_length=80, unique=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    is_active = models.BooleanField(
        default=True,
        help_text="Retired skills stay on existing profiles but stop being offered.",
    )

    class Meta:
        db_table = "skills"
        ordering = ("name",)
        indexes = [models.Index(fields=("category", "is_active"))]

    def __str__(self) -> str:
        return self.name


class EmployeeSkill(TimeStampedModel):
    """One skill claimed by one employee."""

    class Proficiency(models.TextChoices):
        BEGINNER = "beginner", "Beginner"
        INTERMEDIATE = "intermediate", "Intermediate"
        ADVANCED = "advanced", "Advanced"
        EXPERT = "expert", "Expert"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="skills")
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name="employees")
    proficiency = models.CharField(
        max_length=15, choices=Proficiency.choices, default=Proficiency.INTERMEDIATE
    )
    years_of_experience = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)

    class Meta:
        db_table = "employee_skills"
        ordering = ("skill__name",)
        constraints = [
            models.UniqueConstraint(fields=("employee", "skill"), name="uniq_employee_skill")
        ]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} - {self.skill.name}"


class AccountDeletionRequest(TimeStampedModel):
    """HR asks for an account to be closed; an administrator decides.

    Lives here rather than in ``administration`` so the dependency runs one way
    (administration -> employees), and because what it governs is the Employee
    record's lifecycle.

    "Deletion" is a misnomer inherited from the request, and deliberately kept
    as one: approving **deactivates**. Nothing is removed. Leave, timesheets and
    payslips are history someone will need long after the person has gone, and
    payroll records in particular are a statutory obligation.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="deletion_requests"
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deletion_requests_made",
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(help_text="Why the account should be closed.")

    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deletion_requests_decided",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)

    class Meta:
        db_table = "account_deletion_requests"
        ordering = ("-requested_at",)
        constraints = [
            # One open request per employee: a second one would give two
            # administrators the same decision to make.
            models.UniqueConstraint(
                fields=("employee",),
                condition=models.Q(status="pending"),
                name="uniq_open_deletion_request",
            )
        ]
        indexes = [models.Index(fields=("status", "-requested_at"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} deletion ({self.status})"

    @property
    def is_open(self) -> bool:
        return self.status == self.Status.PENDING


class ExperienceDetail(TimeStampedModel):
    """Somewhere the employee worked before joining.

    Kept as rows rather than a free-text box on the profile so it can be
    searched and totalled later; the matching letters go in
    ``EmployeeDocument`` under ``experience_letter``.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="experience_details"
    )
    company_name = models.CharField(max_length=150)
    job_title = models.CharField(max_length=150)
    from_date = models.DateField()
    to_date = models.DateField(
        null=True, blank=True, help_text="Blank means it ran until they joined here."
    )
    description = models.TextField(blank=True)

    class Meta:
        db_table = "employee_experience"
        ordering = ("-from_date",)
        indexes = [models.Index(fields=("employee", "-from_date"))]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} at {self.company_name}"

    @property
    def is_current(self) -> bool:
        return self.to_date is None


#: What "complete" means. Checked server-side before the portal opens, so the
#: gate cannot be walked past by calling the API directly.
#: Module-level alias for drf-spectacular's ENUM_NAME_OVERRIDES, which cannot
#: reach into an inner class by dotted path.
GENDER_CHOICES = Employee.Gender.choices

MANDATORY_PROFILE_FIELDS = (
    "phone",
    "date_of_birth",
    "gender",
    "blood_group",
    "permanent_address",
    "current_address",
    "emergency_contact_name",
    "emergency_contact_phone",
)
