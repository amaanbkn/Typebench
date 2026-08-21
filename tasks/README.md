# Typebench Task Dataset

This directory contains the curated benchmark tasks for Typebench. Each directory represents a standalone task instance.

---

## Directory Structure

Every task folder should follow this layout:

```
tasks/
├── _template/                   # Template task reference
│   ├── repo_ref.json            # Target repository and base commit details
│   ├── instructions.md          # Problem description given to the AI agent
│   └── verify.sh                # Test verification script
│
├── task_001_trpc_router/        # Concrete task instance
│   ├── repo_ref.json
│   ├── instructions.md
│   └── verify.sh
└── ...
```

---

## Task Components

### 1. `repo_ref.json`
Specifies the exact git repository, target base commit (before the fix/feature was implemented), TypeScript version, and package manager required to instantiate the environment.

```json
{
  "task_id": "example_task",
  "repo_url": "https://github.com/example/repo",
  "base_commit": "abc1234567890abcdef1234567890abcdef12345",
  "package_manager": "pnpm",
  "node_version": "20"
}
```

### 2. `instructions.md`
The exact prompt given to the AI agent. This contains the problem description, reproduction steps, expected behavior, and constraints (e.g. "Do not modify public API signatures").

### 3. `verify.sh`
The verification script executed inside the isolated sandbox container after the agent finishes its work.
- Must return exit code `0` for **PASS**.
- Must return non-zero exit code for **FAIL**.
- Should run relevant unit/type tests and prevent regression.
