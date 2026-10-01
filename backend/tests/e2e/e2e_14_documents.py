"""End-to-end: an employee attaching their own certificates, as PDFs."""

from django.core.files.uploadedfile import SimpleUploadedFile
from e2e_harness import Persona, check, data, note, scenario, summarise

asha = Persona("asha.rao@trigyan.io", "Employee")
karthik = Persona("karthik.reddy@trigyan.io", "Employee")
priya = Persona("priya.menon@trigyan.io", "HR")

ASHA = 5
KARTHIK = 6


def pdf(name="certificate.pdf", body=b"%PDF-1.4 a real document"):
    return SimpleUploadedFile(name, body, content_type="application/pdf")


def attach(persona, employee_id, kind, title, upload=None):
    return persona.post(
        f"/api/v1/employees/{employee_id}/documents/",
        {"document_type": kind, "title": title, "file": upload or pdf()},
        multipart=True,
    )


# ---------------------------------------------------------------------------
scenario("Documents: every category the profile offers")
# ---------------------------------------------------------------------------
CATEGORIES = [
    ("tenth", "10th certificate"),
    ("intermediate", "12th certificate"),
    ("bachelors", "Bachelor's certificate"),
    ("masters", "Master's certificate"),
    ("skill_certificate", "AWS Solutions Architect"),
    ("other_education", "Diploma in Design"),
    ("other", "Police clearance"),
]
created = []
for kind, title in CATEGORIES:
    response = attach(asha, ASHA, kind, title)
    check(
        f"an employee can attach a {kind}", response.status_code == 201, str(data(response))[:140]
    )
    if response.status_code == 201:
        created.append(data(response)["id"])

check(
    "skills certifications are a category of their own",
    any(k == "skill_certificate" for k, _ in CATEGORIES),
)

# ---------------------------------------------------------------------------
scenario("Documents: the name is theirs to choose")
# ---------------------------------------------------------------------------
named = attach(asha, ASHA, "tenth", "My class 10 marks memo")
check(
    "a document keeps the name given to it",
    data(named).get("title") == "My class 10 marks memo",
    str(data(named).get("title")),
)

blank = attach(asha, ASHA, "tenth", "   ")
check("a document must be named", blank.status_code == 400, str(blank.status_code))

# ---------------------------------------------------------------------------
scenario("Documents: PDFs, and only PDFs")
# ---------------------------------------------------------------------------
png = attach(
    asha,
    ASHA,
    "tenth",
    "A photo",
    SimpleUploadedFile("scan.png", b"\\x89PNG\\r\\n scan", content_type="image/png"),
)
check("an image is refused", png.status_code == 400, str(png.status_code))

word = attach(
    asha,
    ASHA,
    "other",
    "A CV",
    SimpleUploadedFile("cv.docx", b"PK\\x03\\x04", content_type="application/msword"),
)
check("a Word document is refused", word.status_code == 400, str(word.status_code))

disguised = attach(
    asha,
    ASHA,
    "tenth",
    "Sneaky",
    SimpleUploadedFile("certificate.pdf", b"\\x89PNG not a pdf", content_type="application/pdf"),
)
check(
    "a renamed image is refused on its bytes, not its name",
    disguised.status_code == 400,
    str(disguised.status_code),
)
message = " ".join(data(disguised).get("error", {}).get("details", {}).get("file", []))
check("and the refusal says why", "PDF" in message, message[:120])

huge = attach(
    asha,
    ASHA,
    "other",
    "Enormous",
    SimpleUploadedFile(
        "big.pdf", b"%PDF-" + b"0" * (11 * 1024 * 1024), content_type="application/pdf"
    ),
)
check("an oversized file is refused", huge.status_code == 400, str(huge.status_code))

# ---------------------------------------------------------------------------
scenario("Documents: shown on the profile")
# ---------------------------------------------------------------------------
listed = asha.get(f"/api/v1/employees/{ASHA}/documents/")
check("the profile lists what was attached", listed.status_code == 200, str(listed.status_code))
titles = [row["title"] for row in data(listed)]
for _, title in CATEGORIES:
    check(f'"{title}" is on the profile', title in titles, str(titles)[:160])

check(
    "each carries a link to open it",
    all(row.get("file_url") for row in data(listed)),
    str(data(listed)[:1])[:140],
)
check("and the category it was filed under", all(row.get("document_type") for row in data(listed)))

# ---------------------------------------------------------------------------
scenario("Documents: whose profile is whose")
# ---------------------------------------------------------------------------
check(
    "HR can attach to anyone's record",
    attach(priya, KARTHIK, "tenth", "Karthik 10th").status_code == 201,
)
check(
    "an employee cannot attach to a colleague's",
    attach(asha, KARTHIK, "tenth", "Not mine").status_code in (403, 404),
)
check(
    "nor read a colleague's",
    asha.get(f"/api/v1/employees/{KARTHIK}/documents/").status_code in (403, 404),
)

removed = asha.delete(f"/api/v1/employees/{ASHA}/documents/{created[0]}/")
check("but can take back one of their own", removed.status_code == 204, str(removed.status_code))

note(f"{len(created)} documents attached to employee {ASHA}")
raise SystemExit(summarise())
