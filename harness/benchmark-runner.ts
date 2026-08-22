/**
 * TypeBench Benchmark Execution Orchestrator
 * Executes coding agents across frozen, immutable dataset releases,
 * enforcing pre-execution integrity checks, isolated workspaces, independent evaluation,
 * and comprehensive benchmark run reporting.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyReleaseCheckpoint, DatasetReleaseCheckpoint } from '../dataset/freeze.js';
import { executeAgentOnTask } from '../agents/agent-runner.js';
import { evaluateRun } from '../evaluator/evaluator.js';
import { scoreRun } from '../scoring/scorer.js';

export interface TaskBenchmarkResult {
  taskId: string;
  runId: string;
  repository: string;
  category: string;
  difficulty: string;
  baseCommit: string;
  status: string;
  score: number | null;
  maxScore: number;
  isAvailable: boolean;
  durationMs: number;
  patchLines: number;
}

export interface BenchmarkRunReport {
  benchmarkRunId: string;
  releaseVersion: string;
  datasetFingerprint: string;
  agentName: string;
  timestamp: string;
  totalTasks: number;
  evaluatedTasks: number;
  solvedTasks: number;
  failedTasks: number;
  infrastructureFailures: number;
  passRate: number; // percentage (0 - 100)
  meanScore: number; // average score among available tasks (0 - 100)
  totalDurationMs: number;
  tasks: TaskBenchmarkResult[];
}

export interface BenchmarkExecutionOptions {
  limit?: number;
  timeoutSec?: number;
  verbose?: boolean;
  outputDir?: string;
  tasksDir?: string;
  skipIntegrityCheck?: boolean;
}

/**
 * Runs a coding agent against a frozen dataset release.
 */
export async function runBenchmarkOnRelease(
  releasePathOrVersion: string,
  agentName: string,
  options: BenchmarkExecutionOptions = {}
): Promise<BenchmarkRunReport> {
  const startTime = Date.now();
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  const outputDir =
    options.outputDir ?? path.resolve(process.cwd(), 'results/benchmark-runs');

  let releasePath = path.resolve(process.cwd(), releasePathOrVersion);
  if (!fs.existsSync(releasePath)) {
    const candidate = path.resolve(
      process.cwd(),
      'dataset/releases',
      `v${releasePathOrVersion}.json`
    );
    if (fs.existsSync(candidate)) {
      releasePath = candidate;
    } else {
      const candidateRaw = path.resolve(
        process.cwd(),
        'dataset/releases',
        `${releasePathOrVersion}.json`
      );
      if (fs.existsSync(candidateRaw)) {
        releasePath = candidateRaw;
      }
    }
  }

  if (!fs.existsSync(releasePath)) {
    throw new Error(`Release checkpoint file not found at: ${releasePath}`);
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench] Starting Benchmark Run`);
  console.log(`========================================`);
  console.log(`Release File : ${path.basename(releasePath)}`);
  console.log(`Agent        : ${agentName}\n`);

  // 1. Pre-execution SHA-256 Tamper Verification
  if (!options.skipIntegrityCheck) {
    console.log(`[Benchmark] Verifying release SHA-256 integrity...`);
    const verification = verifyReleaseCheckpoint(releasePath, { tasksDir });
    if (!verification.valid) {
      throw new Error(
        `Release verification failed! Dataset tasks have been modified or corrupted.\nErrors: ${verification.errors.join('; ')}`
      );
    }
    console.log(`[Benchmark] Integrity verified: 🛡️  [PASSED / IMMUTABLE]`);
    console.log(`[Benchmark] Dataset Fingerprint: ${verification.expectedFingerprint}\n`);
  }

  const release: DatasetReleaseCheckpoint = JSON.parse(
    fs.readFileSync(releasePath, 'utf-8')
  );
  const tasksToRun = options.limit
    ? release.tasks.slice(0, options.limit)
    : release.tasks;

  const dateStr = new Date().toISOString().slice(0, 10);
  const benchmarkRunId = `benchmark_v${release.version}_${agentName}_${dateStr}_${Date.now().toString(36)}`;

  console.log(`Benchmark Run ID: ${benchmarkRunId}`);
  console.log(`Executing ${tasksToRun.length} task(s)...\n`);

  const taskResults: TaskBenchmarkResult[] = [];
  let solvedCount = 0;
  let failedCount = 0;
  let infraCount = 0;
  let evaluatedCount = 0;

  // 2. Sequential Task Execution Loop
  for (let i = 0; i < tasksToRun.length; i++) {
    const taskEntry = tasksToRun[i];
    const taskDir = path.join(tasksDir, taskEntry.taskId);

    console.log(`----------------------------------------`);
    console.log(
      `[Task ${i + 1}/${tasksToRun.length}] ${taskEntry.taskId} (${taskEntry.repository})`
    );
    console.log(`Title: "${taskEntry.title}"`);
    console.log(`----------------------------------------`);

    // Step A: Run Coding Agent
    const agentResult = await executeAgentOnTask(taskDir, agentName, {
      timeoutSec: options.timeoutSec ?? 300,
      verbose: options.verbose ?? false,
    });

    // Step B: Independent Evaluation
    const evalResult = await evaluateRun(agentResult.runId, {
      timeoutSec: options.timeoutSec ?? 300,
      verbose: options.verbose ?? false,
      tasksDir: options.tasksDir,
    });

    // Step C: Deterministic Scoring
    const scoreResult = scoreRun(evalResult.runId, {
      verbose: options.verbose ?? false,
    });

    const patchLines = agentResult.patch
      ? agentResult.patch.split('\n').length
      : 0;

    const taskOutcome: TaskBenchmarkResult = {
      taskId: taskEntry.taskId,
      runId: scoreResult.runId,
      repository: taskEntry.repository,
      category: taskEntry.category,
      difficulty: taskEntry.difficulty,
      baseCommit: taskEntry.baseCommit,
      status: scoreResult.status,
      score: scoreResult.score,
      maxScore: scoreResult.maxScore,
      isAvailable: scoreResult.isAvailable,
      durationMs: agentResult.durationMs + evalResult.durationMs,
      patchLines,
    };

    taskResults.push(taskOutcome);

    if (scoreResult.isAvailable) {
      evaluatedCount++;
      if (scoreResult.status === 'solved') {
        solvedCount++;
      } else {
        failedCount++;
      }
    } else {
      infraCount++;
    }

    const scoreDisplay =
      scoreResult.score !== null
        ? `${scoreResult.score}/${scoreResult.maxScore}`
        : 'Unavailable';
    const icon =
      scoreResult.status === 'solved'
        ? '🌟'
        : scoreResult.status === 'failed'
        ? '❌'
        : scoreResult.status === 'infrastructure_failure'
        ? '⚠️ '
        : '❓';

    console.log(
      `-> Result: ${icon} ${scoreResult.status.toUpperCase()} | Score: ${scoreDisplay} | Duration: ${(taskOutcome.durationMs / 1000).toFixed(1)}s\n`
    );
  }

  // 3. Aggregate Metrics Computation
  const passRate =
    evaluatedCount > 0
      ? parseFloat(((solvedCount / evaluatedCount) * 100).toFixed(1))
      : 0;

  const validScoreSum = taskResults
    .filter((t) => t.isAvailable && t.score !== null)
    .reduce((sum, t) => sum + (t.score || 0), 0);

  const meanScore =
    evaluatedCount > 0
      ? parseFloat((validScoreSum / evaluatedCount).toFixed(1))
      : 0;

  const report: BenchmarkRunReport = {
    benchmarkRunId,
    releaseVersion: release.version,
    datasetFingerprint: release.datasetFingerprint,
    agentName,
    timestamp: new Date().toISOString(),
    totalTasks: tasksToRun.length,
    evaluatedTasks: evaluatedCount,
    solvedTasks: solvedCount,
    failedTasks: failedCount,
    infrastructureFailures: infraCount,
    passRate,
    meanScore,
    totalDurationMs: Date.now() - startTime,
    tasks: taskResults,
  };

  // 4. Persist Benchmark Run Report
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `${benchmarkRunId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`[TypeBench] Benchmark report saved to: ${reportPath}\n`);

  return report;
}

/**
 * Formats a terminal-friendly summary table for a benchmark run report.
 */
export function formatBenchmarkReportSummary(report: BenchmarkRunReport): string {
  const lines: string[] = [];

  lines.push(
    '========================================================================================'
  );
  lines.push(
    `TYPEBENCH BENCHMARK RUN SUMMARY (Agent: ${report.agentName} | Release: v${report.releaseVersion})`
  );
  lines.push(
    '========================================================================================\n'
  );

  lines.push(`Benchmark Run ID    : ${report.benchmarkRunId}`);
  lines.push(`Release Version     : v${report.releaseVersion}`);
  lines.push(`Dataset Fingerprint : ${report.datasetFingerprint}`);
  lines.push(`Execution Timestamp : ${report.timestamp}`);
  lines.push(`Total Duration      : ${(report.totalDurationMs / 1000).toFixed(1)}s\n`);

  lines.push(
    `| Metric                  | Value      | Description                                      |`
  );
  lines.push(
    `| ----------------------- | ---------- | ------------------------------------------------ |`
  );
  lines.push(
    `| Total Tasks Executed    | ${String(report.totalTasks).padEnd(10, ' ')} | Total tasks in benchmark suite                   |`
  );
  lines.push(
    `| Evaluated Tasks         | ${String(report.evaluatedTasks).padEnd(10, ' ')} | Tasks with valid sandbox/test execution          |`
  );
  lines.push(
    `| Solved Tasks (Resolved) | ${String(report.solvedTasks).padEnd(10, ' ')} | Tasks passing benchmark tests                    |`
  );
  lines.push(
    `| Failed Tasks            | ${String(report.failedTasks).padEnd(10, ' ')} | Tasks failing benchmark tests                    |`
  );
  lines.push(
    `| Infrastructure Failures | ${String(report.infrastructureFailures).padEnd(10, ' ')} | Excluded environment/toolchain issues            |`
  );
  lines.push(
    `| Benchmark Pass Rate     | ${`${report.passRate.toFixed(1)}%`.padEnd(10, ' ')} | Resolved@1 pass rate (%)                         |`
  );
  lines.push(
    `| Mean Benchmark Score    | ${`${report.meanScore.toFixed(1)}/100`.padEnd(10, ' ')} | Average numerical score (0-100)                  |`
  );

  lines.push(
    '\n----------------------------------------------------------------------------------------'
  );
  lines.push('TASK-BY-TASK EXECUTION BREAKDOWN');
  lines.push(
    '----------------------------------------------------------------------------------------\n'
  );

  report.tasks.forEach((t, i) => {
    const scoreStr =
      t.score !== null ? `${t.score}/${t.maxScore}` : 'Unavailable';
    const icon =
      t.status === 'solved'
        ? '🌟'
        : t.status === 'failed'
        ? '❌'
        : t.status === 'infrastructure_failure'
        ? '⚠️ '
        : '❓';
    lines.push(
      `  ${String(i + 1).padStart(2, ' ')}. [${t.taskId.padEnd(14, ' ')}] (${t.repository.padEnd(6, ' ')}) : ${icon} ${t.status.toUpperCase().padEnd(22, ' ')} | Score: ${scoreStr.padEnd(8, ' ')} | ${(t.durationMs / 1000).toFixed(1)}s`
    );
  });

  lines.push(
    '\n========================================================================================\n'
  );
  return lines.join('\n');
}
