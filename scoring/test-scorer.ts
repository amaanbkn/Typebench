/**
 * TypeBench Scoring Test Suite
 * Tests deterministic scoring rules, component weighting, status classifications, and boundary invariants.
 */

import { computeScore, ScoreResult, SCORING_WEIGHTS } from './scorer.js';
import { EvaluationResult } from '../evaluator/evaluator.js';

function createMockEval(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    runId: 'mock_run_123',
    taskId: 'trpc-c7360d4',
    agentName: 'test-agent',
    status: 'solved',
    benchmarkTests: {
      command: 'pnpm test',
      exitCode: 0,
      passed: true,
      durationMs: 1200,
      status: 'passed',
    },
    regressionTests: {
      command: 'pnpm test',
      exitCode: 0,
      passed: true,
      durationMs: 1500,
      status: 'passed',
    },
    typecheck: {
      command: 'pnpm run typecheck',
      exitCode: 0,
      passed: true,
      durationMs: 800,
      status: 'passed',
    },
    changedFiles: ['src/index.ts'],
    durationMs: 3500,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function runAllTests() {
  console.log('\n========================================');
  console.log('[TypeBench Scorer] Running Test Suite');
  console.log('========================================\n');

  // Case 1: Completely Solved
  console.log('Test 1: Completely Solved Evaluation...');
  const solvedEval = createMockEval();
  const solvedScore = computeScore(solvedEval);
  assert(solvedScore.score === 100, `Expected score 100, got ${solvedScore.score}`);
  assert(solvedScore.status === 'solved', `Expected status 'solved', got ${solvedScore.status}`);
  assert(solvedScore.isAvailable === true, 'Expected isAvailable to be true');
  assert(solvedScore.components.benchmarkTests.score === 70, 'Expected benchmark score 70');
  assert(solvedScore.components.regressionTests.score === 15, 'Expected regression score 15');
  assert(solvedScore.components.typecheck.score === 15, 'Expected typecheck score 15');
  console.log('  ✅ Passed (Score: 100/100)\n');

  // Case 2: Benchmark Tests Fail
  console.log('Test 2: Benchmark Tests Fail...');
  const failEval = createMockEval({
    status: 'failed',
    benchmarkTests: {
      command: 'pnpm test',
      exitCode: 1,
      passed: false,
      durationMs: 1200,
      status: 'failed',
    },
  });
  const failScore = computeScore(failEval);
  assert(failScore.score === 0, `Expected score 0 on benchmark failure, got ${failScore.score}`);
  assert(failScore.status === 'failed', `Expected status 'failed', got ${failScore.status}`);
  assert(failScore.components.benchmarkTests.score === 0, 'Expected benchmark score 0');
  console.log('  ✅ Passed (Score: 0/100)\n');

  // Case 3: No Changes Produced
  console.log('Test 3: No Changes (No-op Agent)...');
  const noChangesEval = createMockEval({
    status: 'no_changes',
    changedFiles: [],
    benchmarkTests: {
      command: 'pnpm test',
      exitCode: 1,
      passed: false,
      durationMs: 0,
      status: 'skipped',
    },
  });
  const noChangesScore = computeScore(noChangesEval);
  assert(noChangesScore.score === 0, `Expected score 0 for no changes, got ${noChangesScore.score}`);
  assert(noChangesScore.status === 'no_changes', `Expected status 'no_changes', got ${noChangesScore.status}`);
  console.log('  ✅ Passed (Score: 0/100)\n');

  // Case 4: Timeout
  console.log('Test 4: Timeout Evaluation...');
  const timeoutEval = createMockEval({
    status: 'timeout',
    benchmarkTests: {
      command: 'pnpm test',
      exitCode: 124,
      passed: false,
      durationMs: 300000,
      status: 'timeout',
    },
  });
  const timeoutScore = computeScore(timeoutEval);
  assert(timeoutScore.score === 0, `Expected score 0 for timeout, got ${timeoutScore.score}`);
  assert(timeoutScore.status === 'timeout', `Expected status 'timeout', got ${timeoutScore.status}`);
  console.log('  ✅ Passed (Score: 0/100)\n');

  // Case 5: Infrastructure Failure
  console.log('Test 5: Infrastructure Failure...');
  const infraEval = createMockEval({
    status: 'infrastructure_failure',
    benchmarkTests: {
      command: 'pnpm test',
      exitCode: 1,
      passed: false,
      durationMs: 0,
      status: 'unavailable',
    },
  });
  const infraScore = computeScore(infraEval);
  assert(infraScore.score === null, `Expected score null for infra failure, got ${infraScore.score}`);
  assert(infraScore.isAvailable === false, 'Expected isAvailable to be false for infra failure');
  assert(infraScore.status === 'infrastructure_failure', 'Expected status infrastructure_failure');
  console.log('  ✅ Passed (Score: null / Unavailable - Agent not penalized)\n');

  // Case 6: Typecheck Fails but Benchmark Passes
  console.log('Test 6: Typecheck Fails but Benchmark Passes...');
  const typeFailEval = createMockEval({
    status: 'failed',
    typecheck: {
      command: 'pnpm run typecheck',
      exitCode: 1,
      passed: false,
      durationMs: 800,
      status: 'failed',
    },
  });
  const typeFailScore = computeScore(typeFailEval);
  assert(typeFailScore.score === 85, `Expected score 85 (70 + 15), got ${typeFailScore.score}`);
  assert(typeFailScore.components.typecheck.score === 0, 'Expected typecheck score 0');
  assert(typeFailScore.components.benchmarkTests.score === 70, 'Expected benchmark score 70');
  assert(typeFailScore.components.regressionTests.score === 15, 'Expected regression score 15');
  console.log('  ✅ Passed (Score: 85/100 - Partial credit for runtime pass with type penalty)\n');

  // Case 7: Regression Tests Fail but Benchmark Passes
  console.log('Test 7: Regression Tests Fail but Benchmark Passes...');
  const regFailEval = createMockEval({
    status: 'failed',
    regressionTests: {
      command: 'pnpm test',
      exitCode: 1,
      passed: false,
      durationMs: 1500,
      status: 'failed',
    },
  });
  const regFailScore = computeScore(regFailEval);
  assert(regFailScore.score === 85, `Expected score 85 (70 + 15), got ${regFailScore.score}`);
  assert(regFailScore.components.regressionTests.score === 0, 'Expected regression score 0');
  assert(regFailScore.components.benchmarkTests.score === 70, 'Expected benchmark score 70');
  assert(regFailScore.components.typecheck.score === 15, 'Expected typecheck score 15');
  console.log('  ✅ Passed (Score: 85/100 - Regression penalty applied)\n');

  // Case 8: Boundary & Invariant Checks
  console.log('Test 8: Invariants & Range Validation...');
  [solvedScore, failScore, noChangesScore, timeoutScore, typeFailScore, regFailScore].forEach((s) => {
    if (s.score !== null) {
      assert(s.score >= 0 && s.score <= 100, `Score ${s.score} out of bounds [0, 100]`);
      assert(!Number.isNaN(s.score), 'Score cannot be NaN');
      assert(Number.isFinite(s.score), 'Score must be finite');
    }
  });
  console.log('  ✅ Passed (All scores in bounds [0, 100], no NaN/Infinity)\n');

  // Case 9: Determinism Verification (10 identical iterations)
  console.log('Test 9: Determinism Verification...');
  const iterEvals = Array.from({ length: 10 }, () => computeScore(solvedEval));
  const firstScore = iterEvals[0].score;
  iterEvals.forEach((res, i) => {
    assert(res.score === firstScore, `Determinism check failed at iteration ${i}`);
  });
  console.log('  ✅ Passed (Identical output across 10 iterations)\n');

  console.log('========================================');
  console.log('🎉 All Scorer Tests Passed Successfully!');
  console.log('========================================\n');
}

runAllTests();
