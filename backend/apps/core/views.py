"""Operational endpoints."""

from django.core.cache import cache
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness — the process is up. Used by the Kubernetes liveness probe."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(tags=["ops"], summary="Liveness check", responses={200: dict})
    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(APIView):
    """
    Readiness — dependencies are reachable.

    Failing readiness pulls the pod out of rotation without killing it, so a brief Redis
    blip degrades capacity instead of causing a crash loop (docs/DEPLOYMENT.md).
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(tags=["ops"], summary="Readiness check", responses={200: dict, 503: dict})
    def get(self, request):
        checks = {
            "database": self._check_database(),
            "cache": self._check_cache(),
        }
        healthy = all(v == "ok" for v in checks.values())
        return Response(
            {"status": "ok" if healthy else "degraded", "checks": checks},
            status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @staticmethod
    def _check_database() -> str:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            return "ok"
        except Exception as exc:
            return f"error: {exc.__class__.__name__}"

    @staticmethod
    def _check_cache() -> str:
        try:
            cache.set("healthcheck", "1", timeout=5)
            return "ok" if cache.get("healthcheck") == "1" else "error: readback failed"
        except Exception as exc:
            return f"error: {exc.__class__.__name__}"
