"""Centralised error handling.

Every failure leaves the API in the same shape, so the frontend has exactly one
error contract to code against::

    {
      "error": {
        "code": "validation_error",
        "message": "Invalid input.",
        "details": {"start_date": ["This field is required."]},
        "request_id": "8f1c..."
      }
    }
"""

import logging

from django.core.exceptions import PermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from common.request_context import get_request_id

logger = logging.getLogger("empportal.api")

ERROR_CODES = {
    status.HTTP_400_BAD_REQUEST: "validation_error",
    status.HTTP_401_UNAUTHORIZED: "not_authenticated",
    status.HTTP_403_FORBIDDEN: "permission_denied",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_429_TOO_MANY_REQUESTS: "throttled",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "server_error",
}

DEFAULT_MESSAGES = {
    status.HTTP_400_BAD_REQUEST: "The submitted data is invalid.",
    status.HTTP_401_UNAUTHORIZED: "Authentication credentials were not provided or have expired.",
    status.HTTP_403_FORBIDDEN: "You do not have permission to perform this action.",
    status.HTTP_404_NOT_FOUND: "The requested resource was not found.",
    status.HTTP_409_CONFLICT: "The request conflicts with the current state of the resource.",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "An unexpected error occurred.",
}


class BusinessRuleViolation(APIException):
    """A domain rule rejected the request (e.g. insufficient leave balance)."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "This action violates a business rule."
    default_code = "business_rule_violation"


class WorkflowStateError(BusinessRuleViolation):
    """An approval workflow does not allow this transition from its current state."""

    default_detail = "This transition is not allowed from the current state."
    default_code = "invalid_workflow_transition"


def _build_body(code: str, message: str, details=None) -> dict:
    body = {"error": {"code": code, "message": message, "request_id": get_request_id()}}
    if details is not None:
        body["error"]["details"] = details
    return body


def api_exception_handler(exc, context) -> Response | None:
    """DRF ``EXCEPTION_HANDLER`` - normalises every error response."""
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(detail=getattr(exc, "message_dict", exc.messages))
    elif isinstance(exc, PermissionDenied):
        from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied

        exc = DRFPermissionDenied()
    elif isinstance(exc, Http404):
        from rest_framework.exceptions import NotFound

        exc = NotFound()
    elif isinstance(exc, IntegrityError):
        exc = BusinessRuleViolation("The request conflicts with existing data.")

    response = drf_exception_handler(exc, context)

    view = context.get("view")
    if response is None:
        logger.exception("Unhandled exception in %s", view.__class__.__name__ if view else "?")
        return Response(
            _build_body(
                ERROR_CODES[status.HTTP_500_INTERNAL_SERVER_ERROR],
                DEFAULT_MESSAGES[status.HTTP_500_INTERNAL_SERVER_ERROR],
            ),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    code = getattr(exc, "default_code", None) or ERROR_CODES.get(response.status_code, "error")
    detail = response.data

    if isinstance(detail, dict) and set(detail) == {"detail"}:
        message, details = str(detail["detail"]), None
    elif isinstance(detail, dict):
        message = DEFAULT_MESSAGES.get(response.status_code, "Request failed.")
        details = detail
    elif isinstance(detail, list):
        message = DEFAULT_MESSAGES.get(response.status_code, "Request failed.")
        details = {"non_field_errors": detail}
    else:
        message, details = str(detail), None

    response.data = _build_body(code, message, details)
    return response
