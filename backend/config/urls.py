"""
Root URL configuration.

Everything the clients use lives under /api/v1/ (SRS §9.11). A breaking change ships as
/api/v2/ with v1 kept live for the deprecation window.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

api_v1 = [
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.accounts.admin_urls")),
    path("", include("apps.masterdata.urls")),
    path("", include("apps.animals.urls")),
    path("", include("apps.inventory.urls")),
    path("ai-events/", include("apps.ai_events.urls")),
    path("payments/", include("apps.payments.urls")),
    path("indents/", include("apps.indents.urls")),
    path("", include("apps.pregnancy.urls")),
    path("integrations/", include("apps.integrations.urls")),
    path("", include("apps.dashboard.urls")),
    path("", include("apps.core.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include((api_v1, "v1"), namespace="v1")),
    # Schema and its two browsable renderings (SRS §9).
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    try:
        import debug_toolbar

        urlpatterns += [path("__debug__/", include(debug_toolbar.urls))]
    except ImportError:
        pass
