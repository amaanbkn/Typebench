# Task: Set Correct Content-Type for Node FormData

## Problem Overview
An issue has been identified in **axios** affecting lib. The current codebase exhibits unexpected behavior or lacks full support for this feature under specific TypeScript configurations and usage patterns.

## Problem Description
When interacting with the affected module(s), the expected behavior or type resolution is not properly maintained. You are tasked with resolving this type fix in the codebase.

## Expected Behavior
1. Ensure all relevant typings and runtime implementations satisfy the intended capability: **Set Correct Content-Type for Node FormData**.
2. Preserve correct TypeScript type inference without introducing `any` casts or regressions.
3. Maintain full backwards compatibility across related APIs.

## Scope & Constraints
- Do not alter public package configurations or remove existing exports unless required.
- Keep your modifications focused strictly on the relevant source files and logic.
- All TypeScript type checks (`tsc --noEmit` or equivalent) must pass cleanly.

## Verification
You can verify your solution using the repository's test runner:
```bash
npm test -- test/unit/adapters/fetch.js
```

Relevant test suites:
- `test/unit/adapters/fetch.js`
