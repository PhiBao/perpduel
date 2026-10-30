# PERPDUEL — backend + executor in one image.
# Stage 1 builds the Rust duel engine; stage 2 runs it beside the TS executor
# (the only process that holds the house testnet keys).
FROM rust:1-slim AS rust-build
WORKDIR /src
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY backend/src ./src
RUN touch src/main.rs && cargo build --release

FROM node:22-slim AS executor-deps
WORKDIR /app
RUN npm i -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=executor-deps /app/node_modules ./node_modules
COPY --from=rust-build /src/target/release/perpduel-backend /usr/local/bin/perpduel-backend
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY executor ./executor
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data
ENV DUEL_STORE=/data/duels.json \
    BIND_ADDR=0.0.0.0 \
    BACKEND_PORT=8080 \
    EXECUTOR_PORT=4101 \
    EXECUTOR_URL=http://127.0.0.1:4101
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
