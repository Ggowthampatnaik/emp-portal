"""Django admin is a maintenance/break-glass tool only; the portal is the UI."""

from django.contrib import admin

from apps.authentication.models import ModulePermission, Role, User, UserRole


@admin.register(ModulePermission)
class ModulePermissionAdmin(admin.ModelAdmin):
    list_display = ("code", "module", "name")
    list_filter = ("module",)
    search_fields = ("code", "name")


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "is_system")
    filter_horizontal = ("permissions",)
    search_fields = ("name", "slug")


class UserRoleInline(admin.TabularInline):
    model = UserRole
    fk_name = "user"
    extra = 0
    autocomplete_fields = ("role",)


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("email", "full_name", "is_active", "is_staff", "last_login_at")
    list_filter = ("is_active", "is_staff", "roles")
    search_fields = ("email", "first_name", "last_name", "entra_upn")
    readonly_fields = ("uuid", "entra_object_id", "last_login_at", "created_at", "updated_at")
    inlines = (UserRoleInline,)
