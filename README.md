# Typebench ⚡

> A rigorous benchmark for evaluating AI coding agents on real-world TypeScript engineering tasks.

---

## Overview

**Typebench** is an automated evaluation benchmark designed to assess the capability of autonomous AI coding agents on complex, real-world TypeScript repositories. Unlike synthetic test cases or isolated function-level benchmarks, Typebench evaluates agents on:

- Real-world production TypeScript codebases
- Complex multi-file refactors, bug fixes, and feature additions
- Deep type-system challenges (generics, template literal types, conditional types, inference)
- End-to-end sandbox verification using native test runners (`vitest`, `jest`, `tsc`)

---

## Project Structure

```
typebench/
├── tasks/                       # Benchmark dataset and task definitions
│   ├── _template/               # Task directory specification & template
│   └── ...                      # Curated benchmark tasks
├── harness/                     # Sandboxed execution & evaluation engine
│   ├── src/                     # CLI entrypoint, docker isolation, scoring
│   └── Dockerfile               # Evaluation sandbox container
├── agents/                      # Pluggable agent wrappers
│   ├── base-agent.ts            # Base interface for all agent adapters
│   ├── nemotron/                # NVIDIA Nemotron agent adapter stub
│   └── README.md                # Guide to adding new agent wrappers
├── scripts/                     # Task generation and curation utilities
│   ├── generate-tasks.ts        # Automated pipeline for task extraction
│   └── seed-repos.json          # Seed TypeScript repositories
├── results/                     # Run logs and leaderboard generation
│   ├── runs/                    # Execution logs and transcripts (gitignored)
│   └── leaderboard/             # Static leaderboard generator & UI
└── docs/                        # Benchmark documentation & methodology
    └── methodology.md           # Task curation, contamination control, scoring
```

---

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/amaanbkn/Typebench.git
cd Typebench

# Install dependencies
npm install
```

### 2. Running a Benchmark Task

```bash
# Run a specific task with an agent
npm run typebench -- run task_001 --agent nemotron

# Run the full benchmark suite
npm run typebench -- run-all --agent nemotron
```

### 3. Generating the Leaderboard

```bash
npm run leaderboard:generate
```

---

## License

[MIT](LICENSE)
