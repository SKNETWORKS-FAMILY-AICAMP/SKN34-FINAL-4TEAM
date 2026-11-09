# syntax=docker/dockerfile:1

FROM ghcr.io/sknetworks-family-aicamp/storyfork-python-builder:latest AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
RUN uv sync --locked --no-dev --no-editable

FROM python:3.11-slim-bookworm AS runtime

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --system storyfork && \
    useradd --system \
        --gid storyfork \
        --home-dir /nonexistent \
        --shell /usr/sbin/nologin \
        storyfork

COPY --from=builder --chown=storyfork:storyfork /app/.venv /app/.venv
COPY --from=builder --chown=storyfork:storyfork /app/app /app/app

USER storyfork:storyfork

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
