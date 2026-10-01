"""Seeds the starter skill vocabulary (decision D10).

Idempotent, and deliberately additive: it never renames, retires or deletes a
skill, because HR may have edited the list and people's profiles point at these
rows. Run it once after ``migrate``; running it again only fills in gaps.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.employees.models import Skill

# (name, category)
SKILLS: list[tuple[str, str]] = [
    # Languages
    ("Python", Skill.Category.LANGUAGE),
    ("Java", Skill.Category.LANGUAGE),
    ("JavaScript", Skill.Category.LANGUAGE),
    ("TypeScript", Skill.Category.LANGUAGE),
    ("C#", Skill.Category.LANGUAGE),
    ("Go", Skill.Category.LANGUAGE),
    ("SQL", Skill.Category.LANGUAGE),
    # Frameworks
    ("Django", Skill.Category.FRAMEWORK),
    ("Spring Boot", Skill.Category.FRAMEWORK),
    ("React", Skill.Category.FRAMEWORK),
    ("Angular", Skill.Category.FRAMEWORK),
    ("Node.js", Skill.Category.FRAMEWORK),
    (".NET", Skill.Category.FRAMEWORK),
    ("REST API design", Skill.Category.FRAMEWORK),
    # Databases
    ("PostgreSQL", Skill.Category.DATABASE),
    ("MySQL", Skill.Category.DATABASE),
    ("MongoDB", Skill.Category.DATABASE),
    ("Redis", Skill.Category.DATABASE),
    # Cloud and DevOps
    ("Microsoft Azure", Skill.Category.CLOUD),
    ("AWS", Skill.Category.CLOUD),
    ("Docker", Skill.Category.CLOUD),
    ("Kubernetes", Skill.Category.CLOUD),
    ("CI/CD", Skill.Category.CLOUD),
    ("Terraform", Skill.Category.CLOUD),
    # Tools
    ("Git", Skill.Category.TOOL),
    ("Jira", Skill.Category.TOOL),
    ("Power BI", Skill.Category.TOOL),
    ("Figma", Skill.Category.TOOL),
    ("Selenium", Skill.Category.TOOL),
    # Domain
    ("Payroll and HRMS", Skill.Category.DOMAIN),
    ("Retail and e-commerce", Skill.Category.DOMAIN),
    ("Banking and finance", Skill.Category.DOMAIN),
    ("Healthcare", Skill.Category.DOMAIN),
    ("Manufacturing", Skill.Category.DOMAIN),
    # Professional
    ("Requirement gathering", Skill.Category.SOFT),
    ("Team leadership", Skill.Category.SOFT),
    ("Client communication", Skill.Category.SOFT),
    ("Agile and Scrum", Skill.Category.SOFT),
    ("Mentoring", Skill.Category.SOFT),
]


class Command(BaseCommand):
    help = "Seeds the starter skill vocabulary. Safe to run repeatedly."

    @transaction.atomic
    def handle(self, *args, **options):
        existing = {name.lower() for name in Skill.objects.values_list("name", flat=True)}
        created = [
            Skill(name=name, category=category)
            for name, category in SKILLS
            if name.lower() not in existing
        ]
        Skill.objects.bulk_create(created)

        self.stdout.write(
            f"Skills: {len(created)} added, {len(existing)} already present "
            f"({Skill.objects.count()} in the vocabulary)."
        )
