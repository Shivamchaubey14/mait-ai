"""
Root URL configuration.

Everything the clients use lives under /api/v1/ (SRS §9.11). A breaking change ships as
/api/v2/ with v1 kept live for the deprecation window.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import RedirectView
from django.views.static import serve
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

    # ------------------------------------------------------------------------------------
    # The admin portal, on the same origin as the API (development only).
    #
    # Deployed, nginx does this: infra/nginx/admin-web.dev.conf serves the static files and
    # proxies /api/ to the API container, which is why the portal's api.js uses a relative
    # path whenever it is served from an ordinary port.
    #
    # Locally the two sit on different ports, which is fine until the portal has to be
    # reached from anywhere but this machine. Through a tunnel the browser is handed the
    # portal on :443 and every request it makes goes to a :8000 that does not exist out
    # there. Serving both from Django puts them on one origin, so a single tunnel is the
    # whole product — the portal for the office and /api/v1 for the handsets, which is
    # already what the mobile preview build points at.
    #
    # Named patterns rather than a document root: admin-web also holds node_modules and the
    # project's own package files, and none of that should be reachable — least of all when
    # the port is open to the internet.
    _portal = settings.BASE_DIR.parent / "admin-web"
    if _portal.is_dir():
        urlpatterns += [
            path("", RedirectView.as_view(url="/index.html", permanent=False)),
            re_path(r"^(?P<path>[\w-]+\.html)$", serve, {"document_root": _portal}),
            re_path(r"^assets/(?P<path>.*)$", serve, {"document_root": _portal / "assets"}),
        ]
