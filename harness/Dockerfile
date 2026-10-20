
# Typebench Evaluation Sandbox
FROM node:24-bookworm-slim

# Install system dependencies & git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    bash \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Corepack selects pnpm from each historical repository's packageManager field.
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate && corepack prepare yarn@4.9.2 --activate
RUN npm install --global bun@1.4.3

WORKDIR /workspace

# Default entrypoint runs bash
ENTRYPOINT ["/bin/bash"]
