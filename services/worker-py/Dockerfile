FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY packages/sdk-py/ /app/packages/sdk-py/
COPY services/worker-py/ /app/services/worker-py/

RUN pip install --upgrade pip setuptools wheel
RUN pip install -e /app/packages/sdk-py
RUN pip install -e /app/services/worker-py

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

ENTRYPOINT ["python", "-m", "jobforge_worker.cli", "run"]
