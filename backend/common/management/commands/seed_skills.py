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


def _group(category: str, *names: str) -> list[tuple[str, str]]:
    return [(name, category) for name in names]


# Added October 2026: a wider vocabulary, so people find their skill in the
# list instead of asking HR for it. Still additive - see the module docstring.
SKILLS += [
    # Programming languages
    *_group(
        Skill.Category.LANGUAGE,
        "C",
        "C++",
        "Kotlin",
        "Swift",
        "Dart",
        "Rust",
        "Ruby",
        "PHP",
        "Scala",
        "R",
        "MATLAB",
        "Perl",
        "Shell scripting",
        "PowerShell",
        "Objective-C",
        "Groovy",
        "VBA",
        "HTML",
        "CSS",
        "COBOL",
        "ABAP",
        "PL/SQL",
        "T-SQL",
    ),
    # Frameworks and libraries
    *_group(
        Skill.Category.FRAMEWORK,
        "Vue.js",
        "Next.js",
        "Nuxt.js",
        "Svelte",
        "Express.js",
        "NestJS",
        "Flask",
        "FastAPI",
        "Ruby on Rails",
        "Laravel",
        "ASP.NET Core",
        "Entity Framework",
        "Hibernate",
        "Spring Framework",
        "Redux",
        "Tailwind CSS",
        "Bootstrap",
        "Material UI",
        "jQuery",
        "Flutter",
        "React Native",
        "GraphQL",
        "gRPC",
        "Pandas",
        "NumPy",
        "TensorFlow",
        "PyTorch",
        "scikit-learn",
        "Keras",
        "OpenCV",
        "Hugging Face Transformers",
        "LangChain",
        "Apache Spark",
        "Hadoop",
        "Jest",
        "JUnit",
        "pytest",
        "Cypress",
    ),
    # Databases and data platforms
    *_group(
        Skill.Category.DATABASE,
        "Oracle Database",
        "Microsoft SQL Server",
        "SQLite",
        "MariaDB",
        "Cassandra",
        "DynamoDB",
        "Elasticsearch",
        "Neo4j",
        "Snowflake",
        "Google BigQuery",
        "Amazon Redshift",
        "Azure Cosmos DB",
        "Firebase",
        "Databricks",
    ),
    # Cloud, DevOps and infrastructure
    *_group(
        Skill.Category.CLOUD,
        "Google Cloud Platform",
        "Jenkins",
        "GitHub Actions",
        "GitLab CI",
        "Azure DevOps",
        "Ansible",
        "Helm",
        "Linux administration",
        "Nginx",
        "Prometheus",
        "Grafana",
        "ELK Stack",
        "Serverless",
        "AWS Lambda",
        "OpenShift",
        "VMware",
        "Computer networking",
        "Site reliability engineering",
        "Windows Server administration",
        "Active Directory",
    ),
    # Tools and platforms
    *_group(
        Skill.Category.TOOL,
        "GitHub",
        "GitLab",
        "Bitbucket",
        "Confluence",
        "Postman",
        "Tableau",
        "Microsoft Excel",
        "Microsoft Office",
        "SAP",
        "Salesforce",
        "ServiceNow",
        "JMeter",
        "Appium",
        "SonarQube",
        "Adobe Photoshop",
        "Adobe Illustrator",
        "Adobe XD",
        "Sketch",
        "Microsoft Dynamics 365",
        "Tally ERP",
        "Zoho",
        "Workday",
        "SharePoint",
        "Power Automate",
        "Power Apps",
        "UiPath",
        "Looker",
        "Splunk",
        "Wireshark",
        "Burp Suite",
        "Trello",
        "Google Analytics",
    ),
    # Industries and business functions
    *_group(
        Skill.Category.DOMAIN,
        "Insurance",
        "Telecom",
        "Logistics and supply chain",
        "Education and e-learning",
        "Travel and hospitality",
        "Real estate",
        "Media and entertainment",
        "Automotive",
        "Energy and utilities",
        "Government and public sector",
        "Pharmaceuticals",
        "Agriculture",
        "Fintech",
        "Capital markets",
        "Accounting",
        "Taxation (GST and TDS)",
        "Statutory compliance (PF and ESI)",
        "Recruitment",
        "Learning and development",
        "Digital marketing",
        "Search engine optimisation",
        "Content writing",
        "Sales",
        "Customer support",
        "Procurement",
        "ERP implementation",
        "Customer relationship management",
    ),
    # Professional skills
    *_group(
        Skill.Category.SOFT,
        "Communication",
        "Presentation skills",
        "Problem solving",
        "Time management",
        "Project management",
        "Stakeholder management",
        "Product management",
        "Business analysis",
        "Negotiation",
        "Conflict resolution",
        "Critical thinking",
        "Decision making",
        "Teamwork",
        "People management",
        "Coaching",
        "Public speaking",
        "Risk management",
        "Change management",
        "Vendor management",
        "Interviewing",
        "Training delivery",
        "Kanban",
    ),
    # Disciplines and practices
    *_group(
        Skill.Category.OTHER,
        "Data science",
        "Machine learning",
        "Artificial intelligence",
        "Generative AI",
        "Natural language processing",
        "Computer vision",
        "Data engineering",
        "Data analysis",
        "Business intelligence",
        "Data modelling",
        "ETL",
        "Cybersecurity",
        "Penetration testing",
        "Security testing",
        "Performance testing",
        "Manual testing",
        "Blockchain",
        "Internet of Things",
        "Embedded systems",
        "Android development",
        "iOS development",
        "Mobile app development",
        "Web development",
        "Full-stack development",
        "Frontend development",
        "Backend development",
        "Microservices",
        "Cloud architecture",
        "UI design",
        "UX research",
        "Technical writing",
        "Accessibility",
        "ITIL",
    ),
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
