# TypeBench v1.0.0

TypeScript-specific benchmark for AI coding agents.

## Dataset

- **Version**: v1.0.0
- **Tasks**: 1
- **Repositories**: 1
- **Fingerprint**: `b64e3a18aed56bd5f4cc18bfe4450b1b95477b0dd27504974f5a976619224084`

## Usage

```bash
npx typebench verify --dataset v1.0.0
npx typebench run --agent <name> --trials 5
npx typebench eval --results results/raw/*.json
npx typebench leaderboard
```

## Protocol

- 70% benchmark correctness (hidden tests)
- 15% typecheck correctness
- 15% regression correctness
- 3 repeated trials minimum
- Anti-contamination enforced

## License

MIT
