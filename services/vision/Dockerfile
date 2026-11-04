# Twin vision service (FastAPI + OpenCV); runs under Docker Compose.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /srv
RUN pip install uv==0.13.0

# Dependencies first (cached layer), exactly as locked.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

ENV PATH="/srv/.venv/bin:$PATH"
# Run as an unprivileged user; uploads only touch the temp directory.
RUN useradd --system --uid 10001 vision
USER vision

# PORT defaults to 8080. One worker per container; scale with replicas, not workers.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
