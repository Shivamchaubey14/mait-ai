"""
URL routes for the zonal manager's app.

All under ``zonal/``, the way the keeper's app is all under ``store/`` and for the same
reason: one prefix, one audience, and nothing of the portal's write surface a path segment
away from it. The manager's decisions themselves post to ``indents/`` — see ``views``.
"""

from django.urls import path

from .views import (
    zonal_approvals,
    zonal_dashboard,
    zonal_event,
    zonal_events,
    zonal_history,
    zonal_home,
    zonal_stock,
)

app_name = "zonal"

urlpatterns = [
    path("zonal/", zonal_home, name="zonal-home"),
    path("zonal/dashboard/", zonal_dashboard, name="zonal-dashboard"),
    path("zonal/approvals/", zonal_approvals, name="zonal-approvals"),
    path("zonal/stock/", zonal_stock, name="zonal-stock"),
    path("zonal/history/", zonal_history, name="zonal-history"),
    path("zonal/events/", zonal_events, name="zonal-events"),
    path("zonal/events/<int:event_id>/", zonal_event, name="zonal-event"),
]
