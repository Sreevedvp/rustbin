# --- Build Stage ---
FROM rust:1.78-slim-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Create a dummy main to cache compilation dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Copy genuine source and compile the release binary
COPY src ./src
COPY frontend ./frontend
RUN touch src/main.rs
RUN cargo build --release

# --- Run Stage ---
FROM debian:bookworm-slim
WORKDIR /app

# Install dynamic subprocess dependencies: Node.js (for JS), rustc & cargo (for Rust compilation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get install -y --no-install-recommends rustc cargo \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy build artifacts and static assets
COPY --from=builder /app/target/release/rustbin /app/rustbin
COPY --from=builder /app/frontend /app/frontend

# Setup temporary sandbox spaces with open permissions for cloud runner
RUN mkdir -p /app/temp_runs /app/temp_cargo && chmod -R 777 /app/temp_runs /app/temp_cargo

# Set critical execution environment configs
ENV PORT=3000
ENV CARGO_HOME=/app/temp_cargo

EXPOSE 3000

# Execute server
CMD ["/app/rustbin"]
