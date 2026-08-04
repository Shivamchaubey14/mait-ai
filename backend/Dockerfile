# =======================================================================================
# Multi-stage build for the Mait AI API (SRS §14 — multi-stage, non-root user).
#
# Stage 1 compiles wheels with the toolchain present; stage 2 installs them into a slim
# runtime that never carries a compiler. Smaller image, smaller attack surface.
# =======================================================================================

# ---------------------------------------------------------------------------- builder ---
FROM python:3.14-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# mysqlclient needs the MySQL client headers and a compiler at build time only.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        default-libmysqlclient-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels
COPY requirements/ requirements/
ARG REQUIREMENTS=requirements/prod.txt
RUN pip wheel --wheel-dir /wheels -r ${REQUIREMENTS}

# ---------------------------------------------------------------------------- runtime ---
FROM python:3.14-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production

# Runtime needs the MySQL client library, not the dev headers or the compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-mysql-client \
        libmariadb3 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root from here on (SRS §14). A container running as root turns a code-execution bug
# into a host problem.
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app

WORKDIR /app

COPY --from=builder /wheels /wheels
COPY requirements/ requirements/
ARG REQUIREMENTS=requirements/prod.txt
RUN pip install --no-index --find-links=/wheels -r ${REQUIREMENTS} \
    && rm -rf /wheels

COPY --chown=app:app . .

RUN mkdir -p /app/staticfiles /app/media && chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/v1/health/ || exit 1

# Workers: 2×cores+1 is the usual starting point; tune against the §7 latency targets.
# --max-requests recycles workers to bound the effect of any slow memory leak.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--threads", "2", \
     "--timeout", "60", \
     "--graceful-timeout", "30", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "100", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
