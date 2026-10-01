"""The skill vocabulary, the per-employee skill set, and the staffing filter.

The filter is the reason the whole feature exists, so the tests that matter
most are the ones proving `?skills=` narrows (AND) rather than widens, and that
it composes with the search and department filters already in use.
"""

import pytest

from apps.employees.models import EmployeeSkill, Skill

SKILLS_URL = "/api/v1/skills/"
EMPLOYEES_URL = "/api/v1/employees/"
DIRECTORY_URL = "/api/v1/employees/directory/"


@pytest.fixture
def vocabulary(db) -> dict[str, Skill]:
    return {
        name: Skill.objects.create(name=name, category=category)
        for name, category in [
            ("React", Skill.Category.FRAMEWORK),
            ("Django", Skill.Category.FRAMEWORK),
            ("PostgreSQL", Skill.Category.DATABASE),
            ("Figma", Skill.Category.TOOL),
        ]
    }


@pytest.fixture
def staffed(org, vocabulary):
    """Two people with an overlapping but not identical skill set."""
    for skill in ("React", "Django", "PostgreSQL"):
        EmployeeSkill.objects.create(employee=org["employee"], skill=vocabulary[skill])
    for skill in ("React", "Figma"):
        EmployeeSkill.objects.create(employee=org["peer"], skill=vocabulary[skill])
    return org


def codes(response) -> set[str]:
    return {row["employee_code"] for row in response.data["results"]}


# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_anyone_signed_in_can_read_the_vocabulary(auth_client, org, vocabulary):
    response = auth_client(org["employee"]).get(SKILLS_URL)

    assert response.status_code == 200
    assert {row["name"] for row in response.data["results"]} == set(vocabulary)


@pytest.mark.django_db
def test_the_type_ahead_matches_anywhere_in_the_name(auth_client, org, vocabulary):
    response = auth_client(org["employee"]).get(SKILLS_URL, {"q": "gres"})

    assert [row["name"] for row in response.data["results"]] == ["PostgreSQL"]


@pytest.mark.django_db
def test_hr_can_extend_the_vocabulary(auth_client, org):
    response = auth_client(org["hr"]).post(SKILLS_URL, {"name": "Kotlin", "category": "language"})

    assert response.status_code == 201, response.data
    assert Skill.objects.filter(name="Kotlin").exists()


@pytest.mark.django_db
def test_an_employee_cannot_extend_it(auth_client, org):
    response = auth_client(org["employee"]).post(SKILLS_URL, {"name": "Kotlin"})
    assert response.status_code == 403


@pytest.mark.django_db
def test_the_same_skill_cannot_be_added_twice_in_a_different_case(auth_client, org, vocabulary):
    response = auth_client(org["hr"]).post(SKILLS_URL, {"name": "react"})

    assert response.status_code == 400
    assert "name" in response.data["error"]["details"]


@pytest.mark.django_db
def test_retiring_a_skill_keeps_it_on_existing_profiles(auth_client, org, staffed, vocabulary):
    response = auth_client(org["hr"]).delete(f"{SKILLS_URL}{vocabulary['React'].pk}/")

    assert response.status_code == 204
    vocabulary["React"].refresh_from_db()
    assert vocabulary["React"].is_active is False
    assert EmployeeSkill.objects.filter(skill=vocabulary["React"]).count() == 2

    listed = auth_client(org["employee"]).get(SKILLS_URL)
    assert "React" not in {row["name"] for row in listed.data["results"]}


@pytest.mark.django_db
def test_the_vocabulary_reports_how_many_people_hold_each_skill(auth_client, org, staffed):
    response = auth_client(org["hr"]).get(SKILLS_URL)

    counts = {row["name"]: row["employee_count"] for row in response.data["results"]}
    assert counts["React"] == 2
    assert counts["Figma"] == 1
    assert counts["Django"] == 1


# ---------------------------------------------------------------------------
# An employee's own skills
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_an_employee_saves_their_own_skills(auth_client, org, vocabulary):
    response = auth_client(org["employee"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {
            "skills": [
                {
                    "skill": vocabulary["React"].pk,
                    "proficiency": "expert",
                    "years_of_experience": "6.5",
                },
                {"skill": vocabulary["Django"].pk},
            ]
        },
        format="json",
    )

    assert response.status_code == 200, response.data
    assert [row["skill_name"] for row in response.data] == ["Django", "React"]
    saved = EmployeeSkill.objects.get(employee=org["employee"], skill=vocabulary["React"])
    assert saved.proficiency == "expert"
    assert str(saved.years_of_experience) == "6.5"


@pytest.mark.django_db
def test_saving_replaces_the_whole_set(auth_client, org, staffed, vocabulary):
    response = auth_client(org["employee"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {"skills": [{"skill": vocabulary["Figma"].pk}]},
        format="json",
    )

    assert response.status_code == 200
    assert [row["skill_name"] for row in response.data] == ["Figma"]
    assert org["employee"].skills.count() == 1


@pytest.mark.django_db
def test_the_same_skill_twice_is_refused(auth_client, org, vocabulary):
    response = auth_client(org["employee"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {"skills": [{"skill": vocabulary["React"].pk}, {"skill": vocabulary["React"].pk}]},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_retired_skill_cannot_be_claimed(auth_client, org, vocabulary):
    vocabulary["Figma"].is_active = False
    vocabulary["Figma"].save(update_fields=["is_active"])

    response = auth_client(org["employee"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {"skills": [{"skill": vocabulary["Figma"].pk}]},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_colleague_cannot_rewrite_someone_elses_skills(auth_client, org, vocabulary):
    response = auth_client(org["peer"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {"skills": [{"skill": vocabulary["React"].pk}]},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_hr_can_correct_an_employees_skills(auth_client, org, vocabulary):
    response = auth_client(org["hr"]).put(
        f"{EMPLOYEES_URL}{org['employee'].pk}/skills/",
        {"skills": [{"skill": vocabulary["Django"].pk}]},
        format="json",
    )
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# The staffing filter
# ---------------------------------------------------------------------------
@pytest.mark.django_db
def test_one_skill_narrows_the_employee_list(auth_client, org, staffed, vocabulary):
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": vocabulary["Django"].pk})

    assert response.status_code == 200
    assert codes(response) == {"TRG0005"}


@pytest.mark.django_db
def test_several_skills_mean_all_of_them(auth_client, org, staffed, vocabulary):
    """Both people know React; only one also knows Django."""
    both = f"{vocabulary['React'].pk},{vocabulary['Django'].pk}"
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": both})

    assert codes(response) == {"TRG0005"}, "the terms must narrow, not widen"


@pytest.mark.django_db
def test_a_shared_skill_returns_everyone_who_has_it(auth_client, org, staffed, vocabulary):
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": vocabulary["React"].pk})
    assert codes(response) == {"TRG0005", "TRG0006"}


@pytest.mark.django_db
def test_nobody_matches_an_impossible_combination(auth_client, org, staffed, vocabulary):
    impossible = f"{vocabulary['Django'].pk},{vocabulary['Figma'].pk}"
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": impossible})
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_each_person_appears_once_however_many_skills_match(auth_client, org, staffed, vocabulary):
    both = f"{vocabulary['React'].pk},{vocabulary['PostgreSQL'].pk}"
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": both})

    returned = [row["employee_code"] for row in response.data["results"]]
    assert returned == ["TRG0005"], "a join must not duplicate rows"


@pytest.mark.django_db
def test_the_filter_respects_visibility_scope(auth_client, org, staffed, vocabulary):
    """An employee filtering by a skill still sees only themselves."""
    response = auth_client(org["employee"]).get(EMPLOYEES_URL, {"skills": vocabulary["React"].pk})
    assert codes(response) == {"TRG0005"}


@pytest.mark.django_db
def test_the_filter_composes_with_the_existing_ones(auth_client, org, staffed, vocabulary):
    response = auth_client(org["hr"]).get(
        EMPLOYEES_URL, {"skills": vocabulary["React"].pk, "search": "Karthik"}
    )
    assert codes(response) == {"TRG0006"}


@pytest.mark.django_db
def test_the_existing_filters_still_work_without_skills(auth_client, org, staffed):
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"search": "Asha"})
    assert codes(response) == {"TRG0005"}


@pytest.mark.django_db
def test_the_directory_can_be_filtered_by_skill_too(auth_client, org, staffed, vocabulary):
    response = auth_client(org["employee"]).get(DIRECTORY_URL, {"skills": vocabulary["Figma"].pk})

    assert response.status_code == 200
    assert codes(response) == {"TRG0006"}


@pytest.mark.django_db
def test_a_nonsense_skill_filter_is_refused(auth_client, org, staffed):
    response = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": "react,django"})

    assert response.status_code == 400
    assert "skills" in response.data["error"]["details"]


@pytest.mark.django_db
def test_an_empty_skill_filter_changes_nothing(auth_client, org, staffed):
    plain = auth_client(org["hr"]).get(EMPLOYEES_URL)
    filtered = auth_client(org["hr"]).get(EMPLOYEES_URL, {"skills": ""})

    assert filtered.data["count"] == plain.data["count"]
