
# Typebench Evaluation Sandbox
FROM node:20-bookworm-slim

# Install system dependencies & git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Enable Corepack for deterministic packageManager (pnpm / yarn) auto-switching
RUN corepack enable && corepack prepare pnpm@latest --activate && corepack prepare yarn@stable --activate

WORKDIR /workspace

# Default entrypoint runs bash
ENTRYPOINT ["/bin/bash"]

