from django.apps import AppConfig


class AnimalsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.animals"
    label = "animals"
    verbose_name = "Animal registry"
