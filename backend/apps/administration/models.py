"""Administration models: audit trail and system configuration.

Planned tables (Phase 7): audit_logs, system_settings
"""

from django.conf import settings
from django.db import models

from common.enums import AuditAction
from common.models import TimeStampedModel


class AuditLog(models.Model):
    """Append-only record of every state-changing action.

    Written by :func:`common.audit.record_audit`, which the workflow services
    call on approve/reject/submit and which the auth views call on sign-in.
    Rows are never updated or deleted from application code.
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_entries",
    )
    actor_email = models.EmailField(
        blank=True, help_text="Denormalised so the trail survives user deletion."
    )
    action = models.CharField(max_length=20, choices=AuditAction.choices, db_index=True)
    entity_type = models.CharField(max_length=100, blank=True, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True)
    entity_label = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "audit_logs"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("entity_type", "entity_id")),
            models.Index(fields=("-created_at", "action")),
        ]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor_email} {self.action}"


class SystemSetting(TimeStampedModel):
    """Runtime configuration an administrator can change without a deploy."""

    class ValueType(models.TextChoices):
        STRING = "string", "String"
        INTEGER = "integer", "Integer"
        DECIMAL = "decimal", "Decimal"
        BOOLEAN = "boolean", "Boolean"

    key = models.CharField(max_length=100, unique=True)
    value = models.CharField(max_length=255)
    value_type = models.CharField(
        max_length=10, choices=ValueType.choices, default=ValueType.STRING
    )
    description = models.TextField(blank=True)
    is_editable = models.BooleanField(default=True)

    class Meta:
        db_table = "system_settings"
        ordering = ("key",)

    def __str__(self) -> str:
        return f"{self.key}={self.value}"

    @property
    def typed_value(self):
        if self.value_type == self.ValueType.INTEGER:
            return int(self.value)
        if self.value_type == self.ValueType.DECIMAL:
            from decimal import Decimal

            return Decimal(self.value)
        if self.value_type == self.ValueType.BOOLEAN:
            return self.value.strip().lower() in {"1", "true", "yes", "on"}
        return self.value
