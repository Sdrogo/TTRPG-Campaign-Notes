#!/usr/bin/env bash
# Installs the backend for CI exactly as uv.lock pins it (ticket 76): every
# package checked against its hash, the dev tools included, then our own
# package built with the locked hatchling and no network fetch. Run from
# backend/, after astral-sh/setup-uv. The image does the same without the
# dev tools (backend/Dockerfile).
set -euo pipefail

work="$(mktemp -d)"
uv export --frozen --extra dev --no-emit-project --quiet --output-file "$work/requirements.txt"
uv export --frozen --only-group build --no-emit-project --quiet --output-file "$work/build-requirements.txt"
pip install --require-hashes -r "$work/requirements.txt" -r "$work/build-requirements.txt"
pip install --no-deps --no-build-isolation -e .
rm -rf "$work"
