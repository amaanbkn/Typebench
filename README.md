# Typebench

Typebench is a benchmark for measuring AI coding agents on real TypeScript repository changes. Tasks are based on historical fixes, run from the exact pre-fix commit, and are evaluated with focused tests, typechecking, and regression checks.

## Current status

- The benchmark runner, evaluator, scorer, dataset checks, repeated-trial protocol, and agent adapters are implemented.
- Task packages live in [`tasks/`](./tasks/). A task is eligible for a release only after its baseline and fix have been validated.
- The current live task manifest is [`dataset/manifest.json`](./dataset/manifest.json).
- Frozen release checkpoints live in [`dataset/releases/`](./dataset/releases/).
- Only a `ready` task should be included in a published benchmark release. `needs-review` tasks are not evidence of a verified task.
- The canonical release is **v0.2.0**, with 9 validated tasks (3 Hono, 3 tRPC, and 3 Zod). Its fingerprint is `sha256:7cf632e0304c6a17d563eaa9fe305ae4d33eeec4499157ccc3ced4a0df8e2742`.
- The v0.1.0 checkpoint is retained as a superseded pre-validation snapshot. The separate [`releases/typebench-v1.0.0/`](./releases/typebench-v1.0.0/) folder is an archived one-task legacy format, not the active release.

See [`docs/methodology.md`](./docs/methodology.md) for curation, reproducibility, anti-contamination, scoring, and release requirements.

## Requirements

- Node.js 24 for the included task set (Node.js 18 or later for Typebench's own tools)
- npm
- Docker for sandbox validation
- Bun, pnpm, or Yarn only when a task's repository uses that package manager

## Setup and checks

```bash
npm ci
npm run typecheck
npm test
```

Inspect dataset readiness without changing task files:

```bash
npm run validate
```

Run Docker-backed task checks when Docker is available:

```bash
npm run typebench -- readiness --run-sandbox --verbose
```

Readiness checks validate task structure and reproducibility surfaces. They do not replace the baseline-fails/fix-passes validation required before promoting a task.

## Dataset release workflow

1. Add a task under `tasks/<task-id>/` with `task.json`, `metadata.json`, and `prompt.md`.
2. Validate that task against its historical parent and fix commit. The candidate validator overlays the fix commit's changed test files onto the parent before running the focused tests.
3. Promote only tasks with a reproducible baseline-fails/fix-passes result to `taskStatus: "ready"`.
4. Rebuild the live manifest and freeze a new version:

   ```bash
   npm run release -- --version 0.2.0
   ```

5. Verify the frozen checksums:

   ```bash
   npm run typebench -- verify --release 0.2.0
   ```

Do not edit task files after freezing a release. Create a new version when the dataset changes.

## Run benchmarks

Run one trial for every task in a frozen release:

```bash
npm run typebench -- run --release 0.2.0 --agent ts-solver
```

Run repeated trials for one agent:

```bash
npm run typebench -- run-all --release 0.2.0 --agent ts-solver --trials 3
```

Compare registered agents using the standardized protocol:

```bash
npm run typebench -- protocol --release 0.2.0 --agents mock,ts-solver --trials 3
```

Run the registered-agent validation workflow:

```bash
npm run typebench -- validate-agent --release 0.2.0 --agent ts-solver --trials 3
```

Runs, evaluations, scores, protocol reports, and reliability summaries are written below [`results/`](./results/).

## Evaluate and report

```bash
npm run typebench -- evaluate <run-id-or-path>
npm run typebench -- score <evaluation-id-or-path>
npm run typebench -- leaderboard --release 0.2.0
```

The leaderboard only compares complete runs from the selected release and omits test-only `mock` and stub `nemotron` results. `ts-solver` is labelled as a heuristic adapter, not a model-backed agent.

## Agent adapters

Adapters are registered in [`agents/agent-runner.ts`](./agents/agent-runner.ts) and implement [`CodingAgent`](./agents/base-agent.ts). The `mock` adapter is for harness testing; `ts-solver` is a heuristic adapter; `nemotron` currently does not perform a model API call. Do not interpret those adapters as external foundation-model evaluations unless a real inference-backed adapter is configured and its calls are confirmed.

## License

[MIT](./LICENSE)
