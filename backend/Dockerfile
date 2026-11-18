# The backend as a container image (spec 23b_1a). Render's native Python
# runtime can't install system packages, and WeasyPrint (the Room PDF, spec
# 23b) needs Pango; a Docker service can. Staging runs this image as a Render
# Docker web service; production still uses the native runtime until it gets
# one too (`context/architecture.md` -> Environments).
#
# Build context is `backend/`, and `.dockerignore` keeps every `.env*` file
# out of it: the image must never carry production values (settings live in
# the Render dashboard).
# The lock, exported with its hashes (ticket 76): runtime packages and the
# build tool. uv only runs in this stage (its image has no shell, hence the
# exec form); the image below never carries it.
FROM ghcr.io/astral-sh/uv:0.13.9@sha256:d3b601f0c7b118bc1753febf7c41cc80981df678445e0254284eecf84db79a7d AS lock
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN ["/uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--quiet", "--output-file", "/src/requirements.txt"]
RUN ["/uv", "export", "--frozen", "--only-group", "build", "--no-emit-project", "--quiet", "--output-file", "/src/build-requirements.txt"]

# By digest as well as tag (ticket 76): a rebuilt tag can't change the
# image under us; Dependabot proposes the new digest.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

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
# Exactly the versions in uv.lock, each checked against its hash, then our
# own package built with the pinned hatchling and no network fetch
# (`--no-build-isolation`, `--no-deps`): nothing reaches the image that the
# lock doesn't name (ticket 76).
COPY --from=lock /src/requirements.txt /src/build-requirements.txt /tmp/
RUN pip install --require-hashes -r /tmp/requirements.txt \
    && pip install --require-hashes -r /tmp/build-requirements.txt
COPY pyproject.toml ./
COPY app ./app
# The build tools then leave the image (none of them is a runtime
# dependency today; if one ever became one, the CI image job's import check
# would fail).
RUN pip install --no-deps --no-build-isolation . \
    && pip uninstall --quiet -y -r /tmp/build-requirements.txt \
    && rm /tmp/requirements.txt /tmp/build-requirements.txt

# Run as an unprivileged user (review of PR #96). It has a home directory so
# fontconfig and WeasyPrint have somewhere to write their caches; the code in
# /app and site-packages stays read-only to it.
RUN useradd --system --create-home --uid 10001 appuser
USER appuser

# Render sets PORT (10000 by default) and expects the service on 0.0.0.0.
# Leave the service's "Docker Command" empty in the dashboard so this runs.
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
