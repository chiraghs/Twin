# Twin intelligence backend (FastAPI), built from the repository root by docker-compose.yml.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/srv TWIN_DATA_DIR=/data
WORKDIR /srv
COPY backend/pyproject.toml backend/pyproject.toml
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('backend/pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt
COPY backend backend
# Same uid as the web image, so both containers can write the shared SQLite database.
RUN useradd --system --uid 10001 twin && mkdir -p /data && chown twin /data
USER twin
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
