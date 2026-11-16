# syntax=docker/dockerfile:1

FROM python:3.11-slim-bookworm AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --extra manuscript --no-install-project

COPY app ./app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --extra manuscript --no-editable

FROM python:3.11-slim-bookworm AS runtime

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MANUSCRIPT_EMBEDDING_MODEL_DIR=/app/models/multilingual-e5-small

WORKDIR /app

RUN groupadd --system storyfork && \
    useradd --system \
        --gid storyfork \
        --home-dir /nonexistent \
        --shell /usr/sbin/nologin \
        storyfork

# 원고 검색 v1 고정 리비전 E5 모델. 체크섬은 app/manuscript/service.py FILES와 같고, 다르면 빌드가 실패한다.
ADD --chmod=444 --checksum=sha256:dd476dd0c2514e9b9be83aeb3853fac0763e0bdf4a71645407587d77c48a2d88 https://huggingface.co/intfloat/multilingual-e5-small/resolve/614241f622f53c4eeff9890bdc4f31cfecc418b3/onnx/model_qint8_avx512_vnni.onnx /app/models/multilingual-e5-small/model_qint8_avx512_vnni.onnx
ADD --chmod=444 --checksum=sha256:0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39 https://huggingface.co/intfloat/multilingual-e5-small/resolve/614241f622f53c4eeff9890bdc4f31cfecc418b3/onnx/tokenizer.json /app/models/multilingual-e5-small/tokenizer.json

COPY --from=builder --chown=storyfork:storyfork /app/.venv /app/.venv
COPY --from=builder --chown=storyfork:storyfork /app/app /app/app

USER storyfork:storyfork

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
