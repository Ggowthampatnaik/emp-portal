"""Profile photo upload.

Kept separate from the main serializer because a photo is a file, not a field
edit: it arrives as multipart, needs its own size and type limits, and replaces
rather than patches. An employee may set their own photo; ``employee.edit``
(HR/Admin) may set anyone's.
"""

from rest_framework import serializers

from apps.employees.models import Employee
from common.media import media_url

MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class EmployeePhotoSerializer(serializers.ModelSerializer):
    """Accepts the upload and echoes back the URL the SPA should render."""

    photo = serializers.ImageField(write_only=True)
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ("photo", "photo_url")

    def get_photo_url(self, obj: Employee) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get("request")
        return media_url(request, obj.photo)

    def validate_photo(self, value):
        if value.size > MAX_PHOTO_BYTES:
            raise serializers.ValidationError(
                f"The photo must be under {MAX_PHOTO_BYTES // (1024 * 1024)} MB; "
                f"this one is {value.size / (1024 * 1024):.1f} MB."
            )

        content_type = getattr(value, "content_type", "")
        if content_type and content_type not in ALLOWED_CONTENT_TYPES:
            raise serializers.ValidationError("Upload a JPEG, PNG or WebP image.")
        return value

    def update(self, instance: Employee, validated_data: dict) -> Employee:
        """Replaces the photo, deleting the previous file so storage stays tidy."""
        previous = instance.photo
        instance.photo = validated_data["photo"]
        instance.save(update_fields=["photo", "updated_at"])
        if previous:
            previous.delete(save=False)
        return instance
