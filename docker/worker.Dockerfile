# Kuvos NEAR extraction worker (Python). Build context: repository root.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY apps/worker/pyproject.toml apps/worker/
COPY apps/worker/src apps/worker/src
RUN pip install ./apps/worker
# Used by the one-shot `storage-init` service to create the documents bucket.
COPY scripts/create-bucket.py scripts/
RUN useradd --create-home --uid 1000 kuvos && mkdir -p /data && chown kuvos /data
USER kuvos
CMD ["python", "-m", "kuvos_worker"]
