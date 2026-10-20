# Typebench release checkpoints

## Canonical release: v0.2.0

- **Tasks**: 9
- **Repositories**: 3 (Hono, tRPC, and Zod; 3 tasks each)
- **Manifest**: [`v0.2.0.json`](./v0.2.0.json)
- **Fingerprint**: `sha256:7cf632e0304c6a17d563eaa9fe305ae4d33eeec4499157ccc3ced4a0df8e2742`
- **Task inclusion rule**: only tasks with a saved `baseline-fails-fixed-passes` validation report are included.

Verify the release against the task files with:

```bash
npm run typebench -- verify --release 0.2.0
```

The v0.1.0 checkpoint is preserved as a superseded snapshot. Its task checksums
refer to the task files as they existed before validation metadata and runtime
commands were corrected. The one-task `releases/typebench-v1.0.0/` directory is
also an archived legacy format and is not consumed by the current CLI.
