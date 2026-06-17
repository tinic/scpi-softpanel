# syntax=docker/dockerfile:1

# ---- web build: produce apps/web/dist ----
FROM node:20-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @scpi/web build

# ---- rust build: the headless server binary ----
FROM rust:1-slim AS rust
WORKDIR /build
# Retry crate downloads and avoid HTTP/2 multiplexing — QEMU-emulated arm64 builds
# otherwise hit flaky "HTTP2 framing layer / connection reset" errors mid-download
# that can fail an entire multi-arch release build.
ENV CARGO_NET_RETRY=10 CARGO_HTTP_MULTIPLEXING=false
COPY rust/ ./
RUN cargo build --release -p scpi-server

# ---- runtime: just the binary + the web bundle ----
FROM debian:trixie-slim AS runtime
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=8080 \
    METER_HOST=192.168.1.166 \
    METER_PORT=5025 \
    WEB_DIST=/app/web \
    CONFIG_PATH=/data/config.json
COPY --from=rust /build/target/release/scpi-server /usr/local/bin/scpi-server
COPY --from=web /app/apps/web/dist /app/web
EXPOSE 8080
VOLUME ["/data"]
CMD ["scpi-server"]
