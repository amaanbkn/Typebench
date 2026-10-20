# Archived TypeBench v1.0.0 Snapshot

This directory contains a legacy, one-task dataset snapshot. Its own task manifest
contains **1 task** from **1 repository**, and the SHA-256 fingerprint in
[`dataset/fingerprint.json`](./dataset/fingerprint.json) matches
[`dataset/tasks.json`](./dataset/tasks.json).

This legacy format is not the active benchmark release and is not consumed by the
current CLI. The canonical release is [`dataset/releases/v0.2.0.json`](../../dataset/releases/v0.2.0.json);
its release manifest, task count, fingerprint, and current usage instructions are
documented in the repository [README](../../README.md).

The task record originated in candidate dataset version `0.2.0`; `v1.0.0` is the
archive label, not the task-record version.

## Legacy snapshot summary

- **Archive label**: `v1.0.0`
- **Tasks**: 1
- **Repositories**: 1
- **Fingerprint algorithm**: SHA-256 over the compact JSON serialization of
  `dataset/tasks.json`
- **Fingerprint**: `b64e3a18aed56bd5f4cc18bfe4450b1b95477b0dd27504974f5a976619224084`

Use the supported commands and workflow in the root [README](../../README.md)
for current benchmark runs.
