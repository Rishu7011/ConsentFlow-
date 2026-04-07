# syntax=docker/dockerfile:1
FROM python:3.12-slim

# Install system dependencies for asyncpg (requires gcc + libpq)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast pip-compatible installer/manager)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pyproject.toml uv.lock README.md ./

# Install production dependencies only, skipping the project source installation (caching layer)
RUN uv sync --frozen --no-dev --no-install-project

# Copy application source
COPY consentflow/ ./consentflow/

# Install the project itself
RUN uv sync --frozen --no-dev

# Expose the port uvicorn listens on
EXPOSE 8000

# Run the ASGI server via uv so the virtualenv is automatically activated
CMD ["uv", "run", "uvicorn", "consentflow.app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
