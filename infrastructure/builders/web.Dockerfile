# syntax=docker/dockerfile:1
# Node 24 + package.json의 pnpm + pnpm-lock 기준 라이브러리를 pnpm store에 미리 받아 둔 빌드용 이미지.
FROM node:24-bookworm-slim
RUN corepack enable
WORKDIR /warm
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack install && pnpm fetch && rm -rf /warm
WORKDIR /app
