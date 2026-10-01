"""Notification API views."""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer


class NotificationViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """A user only ever sees their own notifications."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("is_read", "kind", "level")
    ordering = ("-created_at",)

    queryset = Notification.objects.none()  # schema generation only

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        return Notification.objects.filter(recipient=self.request.user)

    @extend_schema(responses={200: NotificationSerializer})
    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        notification = self.get_object()
        notification.mark_read()
        return Response(self.get_serializer(notification).data)

    @extend_schema(request=None, responses={200: None})
    @action(detail=False, methods=["post"], url_path="read-all")
    def mark_all_read(self, request: Request) -> Response:
        updated = (
            self.get_queryset().filter(is_read=False).update(is_read=True, read_at=timezone.now())
        )
        return Response({"marked_read": updated}, status=status.HTTP_200_OK)

    @extend_schema(responses={200: None})
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request: Request) -> Response:
        return Response({"unread": self.get_queryset().filter(is_read=False).count()})
