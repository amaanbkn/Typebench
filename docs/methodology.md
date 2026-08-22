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

## 4. Scoring Methodology & Metrics

Typebench evaluates task runs deterministically using objective test execution metrics. The evaluation layer produces an `EvaluationResult`, which the scoring engine transforms into a standardized numerical score ($0 \le \text{Score} \le 100$).

### 4.1 Task Score Formulation

Each individual task score is composed of three weighted components totaling **100 points**:

$$\text{Final Score} = S_{\text{benchmark}} + S_{\text{typecheck}} + S_{\text{regression}}$$

| Component | Weight | Max Score | Description |
| :--- | :---: | :---: | :--- |
| **Benchmark Correctness** ($S_{\text{benchmark}}$) | **70%** | **70 pts** | Primary metric evaluating whether the targeted issue was resolved (`benchmarkTests.passed`). |
| **Typecheck Soundness** ($S_{\text{typecheck}}$) | **15%** | **15 pts** | Evaluates whether static type checking passes without compiler errors (`typecheck.passed`). |
| **Regression Prevention** ($S_{\text{regression}}$) | **15%** | **15 pts** | Evaluates whether existing broader test suites continue to pass without regressions. |

### 4.2 Gating & Weight Rationale
- **Dominant Correctness (70%)**: The primary objective is solving the requested engineering problem. An agent that cannot pass the targeted benchmark tests receives **0 points** for the benchmark component.
- **Static Type Integrity (15%)**: In TypeScript engineering, a runtime fix that introduces compile-time type errors is incomplete. The 15% allocation penalizes type breakages while still recognizing runtime improvements.
- **Regression Soundness (15%)**: Ensures fixes do not break existing functionality across the repository.

### 4.3 Evaluation Status Handling Rules
The scoring system handles different execution states explicitly:
- **`solved`**: Benchmark tests passed; total score is computed from component sum (up to `100/100`).
- **`failed`**: Benchmark tests failed; $S_{\text{benchmark}} = 0$, yielding total score `0/100`.
- **`no_changes`**: Agent made no repository modifications; score is strictly **0**.
- **`timeout`**: Execution exceeded the time limit; score is strictly **0**.
- **`infrastructure_failure`**: Environment errors (Docker missing, git clone failure) are **NOT** scored as 0; they are recorded as `score: null` (`isAvailable: false`) to avoid unfairly penalizing agent capability.
- **`invalid_task`**: Corrupt task configurations are marked as `score: null` (`isAvailable: false`).

---

## 5. Aggregate Benchmark Metrics (Future Step)

Task scores are separate from aggregate multi-task metrics:
1. **Pass Rate (Resolved@1)**: Percentage of benchmark tasks where `status === 'solved'`.
2. **Mean Score**: Average score across all valid tasks.
3. **Typecheck Pass Rate**: Percentage of runs where `typecheck.passed === true`.
4. **Token Efficiency**: Average token consumption per resolved task.

