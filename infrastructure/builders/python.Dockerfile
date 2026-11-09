# syntax=docker/dockerfile:1
# Python 3.11 + uv + ai-service uv.lock 기준 라이브러리를 uv 캐시에 미리 받아 둔 빌드용 이미지.
FROM python:3.11-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/
ENV UV_LINK_MODE=copy
WORKDIR /warm
COPY backend/ai-service/pyproject.toml backend/ai-service/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project && rm -rf /warm
WORKDIR /app
