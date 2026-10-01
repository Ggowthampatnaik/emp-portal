"""Fills out the demo profiles so the cards have something to hold back.

The profile page shows the first few skills, roles, documents and assets and
keeps the rest behind "View more". The seeded employees carried one or two of
each, so the button never appeared and the cards looked half-finished.

Run once:

    python manage.py shell < tools_seed_profiles.py

Idempotent - everything is get_or_create, so a second run adds nothing. To undo,
restore db.sqlite3.bak-before-profile-seed.
"""

from datetime import date

from django.core.files.base import ContentFile
from django.db import transaction

from apps.employees.models import (
    Employee,
    EmployeeAsset,
    EmployeeDocument,
    EmployeeSkill,
    ExperienceDetail,
    Skill,
)

#: Whose profiles get opened during a demo.
PEOPLE = [
    "asha.rao@trigyan.io",
    "karthik.reddy@trigyan.io",
    "meera.joshi@trigyan.io",
    "divya.sharma@trigyan.io",
]

SKILLS = {
    "asha.rao@trigyan.io": [
        ("Python", "expert", 6),
        ("Django", "expert", 5),
        ("React", "intermediate", 4),
        ("TypeScript", "intermediate", 3),
        ("PostgreSQL", "advanced", 5),
        ("Docker", "intermediate", 3),
        ("Azure", "beginner", 1),
        ("REST APIs", "expert", 6),
        ("Celery", "intermediate", 2),
        ("Git", "advanced", 7),
    ],
    "karthik.reddy@trigyan.io": [
        ("Java", "advanced", 4),
        ("Spring Boot", "advanced", 4),
        ("Kafka", "intermediate", 2),
        ("MySQL", "advanced", 4),
        ("Docker", "beginner", 1),
        ("Git", "advanced", 4),
    ],
    "meera.joshi@trigyan.io": [
        ("System design", "expert", 8),
        ("Python", "advanced", 7),
        ("Kubernetes", "intermediate", 3),
        ("PostgreSQL", "advanced", 6),
        ("Mentoring", "expert", 5),
    ],
    "divya.sharma@trigyan.io": [
        ("Test automation", "expert", 7),
        ("Selenium", "expert", 7),
        ("Playwright", "advanced", 3),
        ("Python", "intermediate", 4),
        ("CI/CD", "advanced", 4),
    ],
}

EXPERIENCE = {
    "asha.rao@trigyan.io": [
        ("Northwind Software", "Software Engineer", date(2019, 6, 1), date(2021, 2, 14)),
        ("Contoso Systems", "Junior Engineer", date(2017, 8, 1), date(2019, 5, 20)),
        ("Fabrikam Labs", "Intern", date(2017, 1, 9), date(2017, 7, 20)),
        ("Adventure Works", "Trainee", date(2016, 6, 1), date(2016, 12, 20)),
    ],
    "karthik.reddy@trigyan.io": [
        ("Contoso Systems", "Backend Engineer", date(2020, 1, 6), date(2022, 7, 8)),
        ("Litware", "Software Engineer", date(2018, 3, 1), date(2019, 12, 20)),
        ("Proseware", "Intern", date(2017, 7, 1), date(2018, 2, 15)),
    ],
    "meera.joshi@trigyan.io": [
        ("Fabrikam Labs", "Senior Engineer", date(2016, 4, 1), date(2020, 3, 6)),
        ("Northwind Software", "Engineer", date(2013, 6, 1), date(2016, 3, 25)),
        ("Tailspin Toys", "Graduate Engineer", date(2012, 7, 2), date(2013, 5, 30)),
    ],
    "divya.sharma@trigyan.io": [
        ("Litware", "QA Lead", date(2017, 2, 1), date(2020, 11, 20)),
        ("Contoso Systems", "QA Engineer", date(2014, 9, 1), date(2017, 1, 20)),
        ("Proseware", "QA Analyst", date(2013, 1, 7), date(2014, 8, 22)),
    ],
}

ASSETS = {
    "asha.rao@trigyan.io": [
        ("Dell Latitude 5440", "Dell", "TRG-LAP-0051"),
        ('Dell 24" Monitor', "Dell", "TRG-MON-0112"),
        ("Logitech MX Keys", "Logitech", "TRG-KBD-0233"),
        ("Headset H390", "Logitech", "TRG-HST-0341"),
    ],
    "karthik.reddy@trigyan.io": [
        ("Dell Latitude 5440", "Dell", "TRG-LAP-0052"),
        ('Dell 24" Monitor', "Dell", "TRG-MON-0113"),
        ("Docking station", "Dell", "TRG-DCK-0071"),
        ("Headset H390", "Logitech", "TRG-HST-0342"),
    ],
    "meera.joshi@trigyan.io": [
        ("MacBook Pro 14", "Apple", "TRG-LAP-0053"),
        ("LG UltraFine 27", "LG", "TRG-MON-0114"),
        ("Magic Keyboard", "Apple", "TRG-KBD-0234"),
        ("iPhone 14", "Apple", "TRG-PHN-0088"),
    ],
    "divya.sharma@trigyan.io": [
        ("ThinkPad T14", "Lenovo", "TRG-LAP-0054"),
        ('Dell 24" Monitor', "Dell", "TRG-MON-0115"),
        ("Docking station", "Dell", "TRG-DCK-0072"),
        ("Headset H390", "Logitech", "TRG-HST-0343"),
    ],
}

#: One per category, so the grouped headings on the card have something under
#: each. Small placeholder files, matching the ones already seeded.
DOCUMENTS = [
    ("tenth", "10th certificate"),
    ("intermediate", "12th certificate"),
    ("bachelors", "Bachelor's degree"),
    ("experience_letter", "Experience letter"),
    ("id_proof", "PAN card"),
]


def note(msg):
    print(f"  - {msg}")


added = {"skills": 0, "experience": 0, "assets": 0, "documents": 0}

with transaction.atomic():
    for email in PEOPLE:
        employee = Employee.objects.filter(user__email=email).first()
        if employee is None:
            note(f"{email}: no employee record, skipped")
            continue

        for name, proficiency, years in SKILLS.get(email, []):
            skill, _ = Skill.objects.get_or_create(name=name, defaults={"is_active": True})
            _, made = EmployeeSkill.objects.get_or_create(
                employee=employee,
                skill=skill,
                defaults={"proficiency": proficiency, "years_of_experience": years},
            )
            added["skills"] += int(made)

        for company, title, start, end in EXPERIENCE.get(email, []):
            _, made = ExperienceDetail.objects.get_or_create(
                employee=employee,
                company_name=company,
                job_title=title,
                defaults={"from_date": start, "to_date": end},
            )
            added["experience"] += int(made)

        for name, brand, serial in ASSETS.get(email, []):
            _, made = EmployeeAsset.objects.get_or_create(
                employee=employee,
                serial_number=serial,
                defaults={"name": name, "brand": brand},
            )
            added["assets"] += int(made)

        for doc_type, title in DOCUMENTS:
            if employee.documents.filter(document_type=doc_type, title=title).exists():
                continue
            body = f"{title} for {employee.full_name} ({employee.employee_code}).\n".encode()
            document = EmployeeDocument(
                employee=employee,
                document_type=doc_type,
                title=title,
                file_size=len(body),
                content_type="text/plain",
            )
            document.file.save(
                f"{employee.employee_code}-{doc_type}.txt", ContentFile(body), save=True
            )
            added["documents"] += 1

        note(
            f"{employee.full_name}: "
            f"{employee.skills.count()} skills, "
            f"{employee.experience_details.count()} roles, "
            f"{employee.documents.count()} documents, "
            f"{employee.assets.count()} assets"
        )

print(f"added {added}")
