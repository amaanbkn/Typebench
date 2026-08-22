/**
 * Statistical Reliability Metrics Test Suite
 * Validates mathematical formulas (Pass@k, stdDev, 95% CI) and report aggregation.
 */

import {
  computePassAtK,
  computeMeanAndStdDev,
  computeConfidenceInterval95,
  aggregateReliabilityReports,
} from './statistics.js';
import { BenchmarkRunReport } from './benchmark-runner.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function assertClose(actual: number, expected: number, tolerance = 0.01, message = '') {
  if (Math.abs(actual - expected) > tolerance) {
    console.error(
      `❌ ASSERTION FAILED: Expected ~${expected}, got ${actual}. ${message}`
    );
    process.exit(1);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Statistical Reliability Tests');
  console.log('========================================\n');

  // Test 1: Pass@k estimation
  console.log('Test 1: Testing Pass@k combinatorial formula...');
  assertClose(computePassAtK(3, 3, 1), 1.0, 0.001, '3/3 solved should have Pass@1 = 1.0');
  assertClose(computePassAtK(3, 0, 1), 0.0, 0.001, '0/3 solved should have Pass@1 = 0.0');
  assertClose(computePassAtK(3, 1, 1), 0.3333, 0.001, '1/3 solved should have Pass@1 = 0.3333');
  assertClose(computePassAtK(3, 2, 1), 0.6667, 0.001, '2/3 solved should have Pass@1 = 0.6667');
  // Pass@2 for n=5, c=2 -> 1 - (3/5 * 2/4) = 1 - 0.30 = 0.70
  assertClose(computePassAtK(5, 2, 2), 0.7, 0.001, '5 trials, 2 solved, Pass@2 should be 0.70');
  console.log('  ✅ Pass@k formulas verified.\n');

  // Test 2: Mean & Sample Standard Deviation
  console.log('Test 2: Testing Mean and Sample Standard Deviation...');
  const constStats = computeMeanAndStdDev([80, 80, 80]);
  assert(constStats.mean === 80, 'Mean of [80, 80, 80] should be 80');
  assert(constStats.stdDev === 0, 'StdDev of [80, 80, 80] should be 0');

  const spreadStats = computeMeanAndStdDev([60, 80, 100]);
  assert(spreadStats.mean === 80, 'Mean of [60, 80, 100] should be 80');
  assertClose(spreadStats.stdDev, 20, 0.01, 'Sample StdDev of [60, 80, 100] should be 20.0');
  console.log('  ✅ Mean and Standard Deviation verified.\n');

  // Test 3: 95% Confidence Interval
  console.log('Test 3: Testing 95% Confidence Interval...');
  // Mean = 80, StdDev = 20, N = 4 -> SE = 10 -> Margin = 19.6 -> [60.4, 99.6]
  const ci = computeConfidenceInterval95(80, 20, 4);
  assertClose(ci[0], 60.4, 0.1, 'CI lower bound');
  assertClose(ci[1], 99.6, 0.1, 'CI upper bound');
  console.log('  ✅ Confidence Interval calculation verified.\n');

  // Test 4: Reliability Report Aggregation & Flakiness Detection
  console.log('Test 4: Testing Multi-Run Report Aggregation & Flakiness Detection...');
  const mockReport1: BenchmarkRunReport = {
    benchmarkRunId: 'run-1',
    releaseVersion: '0.1.0',
    datasetFingerprint: 'sha256:fake',
    agentName: 'test-agent',
    timestamp: new Date().toISOString(),
    totalTasks: 2,
    evaluatedTasks: 2,
    solvedTasks: 2,
    failedTasks: 0,
    infrastructureFailures: 0,
    passRate: 100,
    meanScore: 100,
    totalDurationMs: 1000,
    tasks: [
      {
        taskId: 'task-stable-pass',
        runId: 'r1-1',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'easy',
        baseCommit: 'c1',
        status: 'solved',
        score: 100,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 10,
      },
      {
        taskId: 'task-flaky',
        runId: 'r1-2',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'medium',
        baseCommit: 'c2',
        status: 'solved',
        score: 100,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 10,
      },
    ],
  };

  const mockReport2: BenchmarkRunReport = {
    benchmarkRunId: 'run-2',
    releaseVersion: '0.1.0',
    datasetFingerprint: 'sha256:fake',
    agentName: 'test-agent',
    timestamp: new Date().toISOString(),
    totalTasks: 2,
    evaluatedTasks: 2,
    solvedTasks: 1,
    failedTasks: 1,
    infrastructureFailures: 0,
    passRate: 50,
    meanScore: 50,
    totalDurationMs: 1000,
    tasks: [
      {
        taskId: 'task-stable-pass',
        runId: 'r2-1',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'easy',
        baseCommit: 'c1',
        status: 'solved',
        score: 100,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 10,
      },
      {
        taskId: 'task-flaky',
        runId: 'r2-2',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'medium',
        baseCommit: 'c2',
        status: 'failed',
        score: 0,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 5,
      },
    ],
  };

  const mockReport3: BenchmarkRunReport = {
    benchmarkRunId: 'run-3',
    releaseVersion: '0.1.0',
    datasetFingerprint: 'sha256:fake',
    agentName: 'test-agent',
    timestamp: new Date().toISOString(),
    totalTasks: 2,
    evaluatedTasks: 2,
    solvedTasks: 1,
    failedTasks: 1,
    infrastructureFailures: 0,
    passRate: 50,
    meanScore: 50,
    totalDurationMs: 1000,
    tasks: [
      {
        taskId: 'task-stable-pass',
        runId: 'r3-1',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'easy',
        baseCommit: 'c1',
        status: 'solved',
        score: 100,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 10,
      },
      {
        taskId: 'task-flaky',
        runId: 'r3-2',
        repository: 'repo-a',
        category: 'bug_fix',
        difficulty: 'medium',
        baseCommit: 'c2',
        status: 'failed',
        score: 0,
        maxScore: 100,
        isAvailable: true,
        durationMs: 500,
        patchLines: 5,
      },
    ],
  };

  const agg = aggregateReliabilityReports([mockReport1, mockReport2, mockReport3]);

  assert(agg.trialsCount === 3, 'Should aggregate 3 trials');
  assert(agg.totalTasks === 2, 'Should aggregate 2 tasks');
  assert(agg.flakyTasksCount === 1, 'Should detect exactly 1 flaky task');
  assert(agg.flakyTaskIds.includes('task-flaky'), 'task-flaky should be identified as flaky');
  assert(agg.tasks['task-stable-pass'].isConsistent === true, 'task-stable-pass should be consistent');
  assert(agg.tasks['task-flaky'].isFlaky === true, 'task-flaky should be marked isFlaky');
  assert(agg.consistencyRate === 50, 'Consistency rate should be 50%');

  console.log('  ✅ Aggregation and flakiness detection verified.\n');

  console.log('========================================');
  console.log('🎉 All Statistical Reliability Tests Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal statistics test error:', err);
  process.exit(1);
});
