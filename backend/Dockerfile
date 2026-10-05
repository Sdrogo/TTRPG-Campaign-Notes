# The backend as a container image (spec 23b_1a). Render's native Python
# runtime can't install system packages, and WeasyPrint (the Room PDF, spec
# 23b) needs Pango; a Docker service can. Staging runs this image as a Render
# Docker web service; production still uses the native runtime until it gets
# one too (`context/architecture.md` -> Environments).
#
# Build context is `backend/`, and `.dockerignore` keeps every `.env*` file
# out of it: the image must never carry production values (settings live in
# the Render dashboard).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# What WeasyPrint loads at run time (its documentation's Debian list), plus
# fontconfig, which Pango uses to find fonts. The Room PDF bundles its own
# fonts, so no font package is installed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz-subset0 \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The package is installed, not run from the source tree, like on Render's
# native runtime. Migrations stay a by-hand step (`architecture.md` →
# Environments), so `alembic` and `migrations/` are not needed at run time.
COPY pyproject.toml ./
COPY app ./app
RUN pip install .

# Run as an unprivileged user (review of PR #96). It has a home directory so
# fontconfig and WeasyPrint have somewhere to write their caches; the code in
# /app and site-packages stays read-only to it.
RUN useradd --system --create-home --uid 10001 appuser
USER appuser

# Render sets PORT (10000 by default) and expects the service on 0.0.0.0.
# Leave the service's "Docker Command" empty in the dashboard so this runs.
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
