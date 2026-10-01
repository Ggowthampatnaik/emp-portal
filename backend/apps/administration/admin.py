"""Administration admin registrations."""

from django.contrib import admin

from apps.administration.models import AuditLog, SystemSetting


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor_email", "action", "entity_type", "entity_label")
    list_filter = ("action", "entity_type")
    search_fields = ("actor_email", "entity_label", "request_id")
    readonly_fields = tuple(field.name for field in AuditLog._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = ("key", "value", "value_type", "is_editable")
    search_fields = ("key", "description")
