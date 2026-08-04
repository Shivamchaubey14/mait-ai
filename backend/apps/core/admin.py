from django.contrib import admin

from .models import AuditLog, IdempotencyRecord


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Read-only by design — an editable audit trail is not an audit trail."""

    list_display = ("created_at", "action", "entity_type", "entity_id", "actor")
    list_filter = ("action", "entity_type", "created_at")
    search_fields = ("entity_id", "request_id")
    date_hierarchy = "created_at"
    readonly_fields = tuple(f.name for f in AuditLog._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(IdempotencyRecord)
class IdempotencyRecordAdmin(admin.ModelAdmin):
    list_display = ("key", "endpoint", "response_status", "created_at", "expires_at")
    search_fields = ("key", "endpoint")
    readonly_fields = tuple(f.name for f in IdempotencyRecord._meta.fields)
