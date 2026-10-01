"""Phase 0 smoke tests - the scaffold boots, routes resolve, errors are uniform."""

import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_check_reports_ok(api_client):
    response = api_client.get("/healthz/")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["checks"] == {"database": "ok", "cache": "ok"}


@pytest.mark.django_db
def test_request_id_is_echoed_back(api_client):
    response = api_client.get("/healthz/", HTTP_X_REQUEST_ID="correlation-123")
    assert response["X-Request-ID"] == "correlation-123"


@pytest.mark.django_db
def test_openapi_schema_is_generated(api_client, django_user_model):
    # Staff only: the schema is the map of every route and permission, and it
    # is not handed to anonymous visitors. dev.py opens it for local work.
    staff = django_user_model.objects.create_user(
        email="staff@trigyan.io", password="Portal@123", is_staff=True
    )
    api_client.force_authenticate(staff)

    response = api_client.get(reverse("schema"))
    assert response.status_code == 200
    assert b"Trigyan Employee Management Portal API" in response.content


@pytest.mark.django_db
def test_openapi_schema_is_not_public(api_client):
    assert api_client.get(reverse("schema")).status_code in (401, 403)
    assert api_client.get(reverse("swagger-ui")).status_code in (401, 403)


@pytest.mark.django_db
def test_protected_endpoint_rejects_anonymous_users(api_client):
    response = api_client.get("/api/v1/auth/me/")
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "not_authenticated"
    assert body["error"]["request_id"]


@pytest.mark.django_db
def test_error_envelope_shape_on_not_found(api_client, auth_client, employee_user):
    client = auth_client(employee_user)
    response = client.get("/api/v1/auth/does-not-exist/")
    assert response.status_code == 404
    assert set(response.json()["error"]) >= {"code", "message", "request_id"}
