from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from apps.accounts.models import InstitutionAccessRequest, InstitutionAdminInvitation, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "is_staff", "is_active")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "is_platform_admin",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2", "is_staff"),
            },
        ),
    )
    search_fields = ("email", "first_name", "last_name")


@admin.register(InstitutionAdminInvitation)
class InstitutionAdminInvitationAdmin(admin.ModelAdmin):
    list_display = ("email", "status", "expires_at", "invited_by", "created_at")
    list_filter = ("status",)
    search_fields = ("email",)
    readonly_fields = ("token_hash", "accepted_at", "created_at", "updated_at")


@admin.register(InstitutionAccessRequest)
class InstitutionAccessRequestAdmin(admin.ModelAdmin):
    list_display = ("institution_name", "contact_name", "email", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("institution_name", "contact_name", "email")
    readonly_fields = ("reviewed_by", "reviewed_at", "invitation", "created_at", "updated_at")
