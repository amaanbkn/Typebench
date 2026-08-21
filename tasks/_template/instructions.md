# Task: Fix Type Inference in Async Handler Callback

## Problem Description
When chaining asynchronous handler callbacks with custom generic options, the compiler fails to correctly infer the return type of nested promises, falling back to `unknown`.

## Steps to Reproduce
1. Define a router schema with nested route options.
2. Provide an async resolver returning `{ data: T }`.
3. Notice that `typeof result` resolves to `unknown` instead of `T`.

## Expected Behavior
The generic helper type `InferHandlerOutput<T>` should correctly unwrap nested `PromiseLike` return values and maintain type narrowing across chained handlers.

## Requirements
- Fix the type definitions in `src/types/router.ts`.
- Ensure all existing tests pass (`npm test`).
- Add tests covering the regression in `test/inference.test.ts`.
