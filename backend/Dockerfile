# Twin intelligence backend (FastAPI)
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/srv TWIN_DATA_DIR=/data
WORKDIR /srv

# Works with either build context: repository root (.) or the backend directory (backend/)
COPY . /tmp/build-context
RUN if [ -f /tmp/build-context/backend/pyproject.toml ]; then \
      cp -r /tmp/build-context/backend /srv/backend; \
    else \
      mkdir -p /srv/backend && cp -a /tmp/build-context/. /srv/backend/; \
    fi && \
    rm -rf /tmp/build-context

RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('/srv/backend/pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

# Same uid as the web image, so both containers can write the shared SQLite database.
RUN useradd --system --uid 10001 twin && mkdir -p /data && chown twin /data
USER twin
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
