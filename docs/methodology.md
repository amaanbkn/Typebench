# Typebench Methodology

This document details the design principles, task curation process, execution environment, and scoring criteria for Typebench.

---

## 1. Motivation

Most existing coding benchmarks (HumanEval, MBPP, etc.) measure simple standalone algorithmic functions in Python without multi-file context or strict static type systems. SWE-bench introduced real-world GitHub issues for Python.

**Typebench** specifically targets the **TypeScript** ecosystem, evaluating agents on:
- Large modular codebases with interconnected type hierarchies.
- Real production pull requests (bug fixes, feature additions, typing refactors).
- Complex TypeScript features: generic inference, conditional types, mapped types, template literal types, and AST transformations.

---

## 2. Task Curation Criteria

Candidate tasks are extracted from popular open-source TypeScript repositories (see [`scripts/seed-repos.json`](../scripts/seed-repos.json)) following strict quality filters:

1. **Deterministic Reproducibility**: The repository must have an automated test suite runnable via `npm`, `pnpm`, or `yarn`.
2. **Atomic Changes**: The task corresponds to an issue/PR with clear scope.
3. **Fail-to-Pass Verification**: The task must fail on the base commit and pass on the target fix commit without modifying test files or cheat assertions.
4. **Anti-Contamination Measures**:
   - Stripping commit messages, issue discussions, and PR links.
   - Standardizing prompt instructions into neutral requirements.

---

## 3. Sandboxed Execution & Isolation

- Each evaluation runs inside an isolated Docker container with pre-installed Node.js, TypeScript tooling, and isolated network access (optional).
- The agent is provided a fresh checkout of the base commit.
- Once the agent signals completion or hits the timeout limit, the evaluation harness executes `verify.sh`.

---

## 4. Scoring & Metrics

1. **Pass Rate (Resolved@1)**: Percentage of tasks where `verify.sh` exits with code `0`.
2. **Typecheck Pass Rate**: Percentage of tasks where `tsc --noEmit` succeeds without type errors.
3. **Token Efficiency**: Number of prompt, output, and reasoning tokens consumed.
4. **Execution Time**: Total wall-clock time spent by the agent.
