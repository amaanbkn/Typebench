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

# Install modern package managers
RUN npm install -g pnpm@latest yarn@latest

WORKDIR /workspace

# Default entrypoint runs bash
ENTRYPOINT ["/bin/bash"]
