FROM ghcr.io/sknetworks-family-aicamp/storyfork-web-builder:latest AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prefer-offline
COPY . ./
# Public same-origin API path only; no secret build arguments.
ENV VITE_CORE_API_BASE_URL=/
RUN pnpm build

FROM nginx:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
