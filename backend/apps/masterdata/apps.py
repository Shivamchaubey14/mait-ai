from django.apps import AppConfig


class MasterdataConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.masterdata"
    label = "masterdata"
    verbose_name = "SAP master data"

    def ready(self):
        # Registers the receiver that keeps a Mait's login account carrying the Mait's name.
        from . import signals  # noqa: F401
