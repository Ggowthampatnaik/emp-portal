"""Notification serializers."""

from rest_framework import serializers

from apps.notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = (
            "id",
            "kind",
            "level",
            "title",
            "message",
            "link",
            "is_read",
            "read_at",
            "created_at",
        )
        read_only_fields = fields
