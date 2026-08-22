/**
 * TypeBench Statistical Reliability & Repeated Benchmark Metrics Engine
 * Computes Pass@k, score variance, standard deviation, 95% confidence intervals,
 * and task flakiness across independent repeated benchmark trials.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runBenchmarkOnRelease, BenchmarkRunReport, BenchmarkExecutionOptions } from './benchmark-runner.js';

export interface TaskStabilityStats {
  taskId: string;
  repository: string;
  trialsCount: number;
  solvedTrials: number;
  failedTrials: number;
  passRate: number; // percentage (0 - 100)
  passAt1: number; // probability (0 - 1)
  isConsistent: boolean; // all passed or all failed
  isFlaky: boolean; // mixed outcomes across trials
  scores: number[];
  meanScore: number;
  scoreStdDev: number;
}

export interface AgentReliabilityReport {
  reportId: string;
  releaseVersion: string;
  datasetFingerprint: string;
  agentName: string;
  trialsCount: number;
  totalTasks: number;
  passAt1: number; // percentage (0 - 100)
  meanScore: number; // average score (0 - 100)
  scoreStdDev: number;
  confidenceInterval95: [number, number];
  consistencyRate: number; // percentage of tasks with deterministic outcomes (0 - 100)
  flakyTasksCount: number;
  flakyTaskIds: string[];
  totalDurationMs: number;
  timestamp: string;
  tasks: Record<string, TaskStabilityStats>;
  runReportIds: string[];
}

export interface RepeatedBenchmarkOptions extends BenchmarkExecutionOptions {
  trials?: number;
  outputReliabilityDir?: string;
}

/**
 * Computes unbiased Pass@k metric using the hypergeometric formulation:
 * Pass@k = 1 - product_{i=1}^k (n - c - i + 1) / (n - i + 1)
 */
export function computePassAtK(n: number, c: number, k = 1): number {
  if (n <= 0 || k <= 0 || k > n) return 0;
  if (c <= 0) return 0;
  if (n - c < k) return 1;

  let prod = 1;
  for (let i = 1; i <= k; i++) {
    prod *= (n - c - i + 1) / (n - i + 1);
  }
  return parseFloat((1 - prod).toFixed(4));
}

/**
 * Computes mean, sample variance, and sample standard deviation for a set of numbers.
 */
export function computeMeanAndStdDev(values: number[]): {
  mean: number;
  stdDev: number;
  variance: number;
} {
  if (!values || values.length === 0) {
    return { mean: 0, stdDev: 0, variance: 0 };
  }

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;

  if (n === 1) {
    return { mean: parseFloat(mean.toFixed(2)), stdDev: 0, variance: 0 };
  }

  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  return {
    mean: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    variance: parseFloat(variance.toFixed(2)),
  };
}

/**
 * Computes 95% confidence interval [lower, upper] based on sample mean and standard error.
 */
export function computeConfidenceInterval95(
  mean: number,
  stdDev: number,
  n: number
): [number, number] {
  if (n <= 1 || stdDev === 0) {
    return [mean, mean];
  }
  const standardError = stdDev / Math.sqrt(n);
  const margin = 1.96 * standardError;

  const lower = Math.max(0, parseFloat((mean - margin).toFixed(2)));
  const upper = Math.min(100, parseFloat((mean + margin).toFixed(2)));

  return [lower, upper];
}

/**
 * Aggregates multiple independent BenchmarkRunReports into an AgentReliabilityReport.
 */
export function aggregateReliabilityReports(
  runReports: BenchmarkRunReport[]
): AgentReliabilityReport {
  if (!runReports || runReports.length === 0) {
    throw new Error('Cannot aggregate empty benchmark run reports');
  }

  const first = runReports[0];
  const agentName = first.agentName;
  const releaseVersion = first.releaseVersion;
  const datasetFingerprint = first.datasetFingerprint;
  const trialsCount = runReports.length;

  const taskStatsMap: Record<string, TaskStabilityStats> = {};
  const runReportIds = runReports.map((r) => r.benchmarkRunId);
  const allMeanScores: number[] = [];

  // Group by task ID across all runs
  for (const report of runReports) {
    allMeanScores.push(report.meanScore);

    for (const taskResult of report.tasks) {
      if (!taskStatsMap[taskResult.taskId]) {
        taskStatsMap[taskResult.taskId] = {
          taskId: taskResult.taskId,
          repository: taskResult.repository,
          trialsCount: 0,
          solvedTrials: 0,
          failedTrials: 0,
          passRate: 0,
          passAt1: 0,
          isConsistent: true,
          isFlaky: false,
          scores: [],
          meanScore: 0,
          scoreStdDev: 0,
        };
      }

      const tStats = taskStatsMap[taskResult.taskId];
      tStats.trialsCount++;
      if (taskResult.status === 'solved') {
        tStats.solvedTrials++;
      } else {
        tStats.failedTrials++;
      }
      if (taskResult.score !== null) {
        tStats.scores.push(taskResult.score);
      }
    }
  }

  const taskEntries = Object.values(taskStatsMap);
  let totalTasks = taskEntries.length;
  let consistentCount = 0;
  const flakyTaskIds: string[] = [];

  for (const t of taskEntries) {
    t.passRate =
      t.trialsCount > 0
        ? parseFloat(((t.solvedTrials / t.trialsCount) * 100).toFixed(1))
        : 0;
    t.passAt1 = computePassAtK(t.trialsCount, t.solvedTrials, 1);

    t.isConsistent =
      t.solvedTrials === t.trialsCount || t.failedTrials === t.trialsCount;
    t.isFlaky = !t.isConsistent;

    if (t.isConsistent) {
      consistentCount++;
    } else {
      flakyTaskIds.push(t.taskId);
    }

    const { mean, stdDev } = computeMeanAndStdDev(t.scores);
    t.meanScore = mean;
    t.scoreStdDev = stdDev;
  }

  const consistencyRate =
    totalTasks > 0
      ? parseFloat(((consistentCount / totalTasks) * 100).toFixed(1))
      : 100;

  const { mean: overallMeanScore, stdDev: overallStdDev } =
    computeMeanAndStdDev(allMeanScores);
  const confidenceInterval95 = computeConfidenceInterval95(
    overallMeanScore,
    overallStdDev,
    trialsCount
  );

  const avgPassAt1 =
    totalTasks > 0
      ? parseFloat(
          (
            (taskEntries.reduce((sum, t) => sum + t.passAt1, 0) / totalTasks) *
            100
          ).toFixed(1)
        )
      : 0;

  const totalDurationMs = runReports.reduce(
    (sum, r) => sum + r.totalDurationMs,
    0
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const reportId = `reliability_v${releaseVersion}_${agentName}_${trialsCount}x_${dateStr}_${Date.now().toString(36)}`;

  return {
    reportId,
    releaseVersion,
    datasetFingerprint,
    agentName,
    trialsCount,
    totalTasks,
    passAt1: avgPassAt1,
    meanScore: overallMeanScore,
    scoreStdDev: overallStdDev,
    confidenceInterval95,
    consistencyRate,
    flakyTasksCount: flakyTaskIds.length,
    flakyTaskIds,
    totalDurationMs,
    timestamp: new Date().toISOString(),
    tasks: taskStatsMap,
    runReportIds,
  };
}

/**
 * Executes repeated independent benchmark runs for an agent and computes statistical reliability metrics.
 */
export async function runRepeatedBenchmark(
  releasePathOrVersion: string,
  agentName: string,
  options: RepeatedBenchmarkOptions = {}
): Promise<AgentReliabilityReport> {
  const trialsCount = options.trials ?? 3;
  const outputReliabilityDir =
    options.outputReliabilityDir ??
    path.resolve(process.cwd(), 'results/reliability');

  console.log(`\n========================================`);
  console.log(`[TypeBench] Starting Repeated Benchmark Reliability Run`);
  console.log(`========================================`);
  console.log(`Release Checkpoint : ${releasePathOrVersion}`);
  console.log(`Agent Target       : ${agentName}`);
  console.log(`Repeated Trials    : ${trialsCount} independent runs\n`);

  const runReports: BenchmarkRunReport[] = [];

  for (let trial = 1; trial <= trialsCount; trial++) {
    console.log(`========================================================================================`);
    console.log(`>>> EXECUTING TRIAL [${trial}/${trialsCount}]`);
    console.log(`========================================================================================\n`);

    const report = await runBenchmarkOnRelease(releasePathOrVersion, agentName, {
      ...options,
      skipIntegrityCheck: trial > 1, // only verify fingerprint on trial 1
    });

    runReports.push(report);
  }

  const reliabilityReport = aggregateReliabilityReports(runReports);

  // Persist reliability report
  fs.mkdirSync(outputReliabilityDir, { recursive: true });
  const reportFilePath = path.join(
    outputReliabilityDir,
    `${reliabilityReport.reportId}.json`
  );
  fs.writeFileSync(
    reportFilePath,
    JSON.stringify(reliabilityReport, null, 2),
    'utf-8'
  );

  console.log(
    `[TypeBench] Statistical reliability report saved to: ${reportFilePath}\n`
  );

  return reliabilityReport;
}

/**
 * Formats a terminal-friendly summary table for an AgentReliabilityReport.
 */
export function formatReliabilityReportSummary(
  report: AgentReliabilityReport
): string {
  const lines: string[] = [];

  lines.push(
    '========================================================================================'
  );
  lines.push(
    `TYPEBENCH STATISTICAL RELIABILITY SUMMARY (Agent: ${report.agentName} | ${report.trialsCount} Trials)`
  );
  lines.push(
    '========================================================================================\n'
  );

  lines.push(`Report ID           : ${report.reportId}`);
  lines.push(`Release Version     : v${report.releaseVersion}`);
  lines.push(`Dataset Fingerprint : ${report.datasetFingerprint}`);
  lines.push(`Trials Executed     : ${report.trialsCount} independent runs`);
  lines.push(`Total Tasks         : ${report.totalTasks}`);
  lines.push(`Total Duration      : ${(report.totalDurationMs / 1000).toFixed(1)}s\n`);

  lines.push(
    `| Statistical Metric         | Value             | Description                                     |`
  );
  lines.push(
    `| -------------------------- | ----------------- | ----------------------------------------------- |`
  );
  lines.push(
    `| Pass@1 (Resolved@1)        | ${`${report.passAt1.toFixed(1)}%`.padEnd(17, ' ')} | Probability of solving task on 1st attempt      |`
  );
  lines.push(
    `| Mean Benchmark Score       | ${`${report.meanScore.toFixed(1)} / 100`.padEnd(17, ' ')} | Average numerical score across all trials       |`
  );
  lines.push(
    `| Score Standard Deviation   | ${`±${report.scoreStdDev.toFixed(2)} pts`.padEnd(17, ' ')} | Score dispersion across repeated trials (σ)      |`
  );
  lines.push(
    `| 95% Confidence Interval    | ${`[${report.confidenceInterval95[0]}, ${report.confidenceInterval95[1]}]`.padEnd(17, ' ')} | True expected mean score range (95% confidence) |`
  );
  lines.push(
    `| Task Consistency Rate      | ${`${report.consistencyRate.toFixed(1)}%`.padEnd(17, ' ')} | Tasks with identical outcome across all runs    |`
  );
  lines.push(
    `| Flaky Tasks Count          | ${`${report.flakyTasksCount}`.padEnd(17, ' ')} | Tasks exhibiting non-deterministic outcomes     |`
  );

  lines.push(
    '\n----------------------------------------------------------------------------------------'
  );
  lines.push('PER-TASK STABILITY BREAKDOWN');
  lines.push(
    '----------------------------------------------------------------------------------------\n'
  );

  Object.values(report.tasks).forEach((t, i) => {
    const statusIcon = t.isConsistent
      ? t.solvedTrials === t.trialsCount
        ? '🌟 100% PASS'
        : '❌ 0% PASS'
      : '⚠️  FLAKY';
    lines.push(
      `  ${String(i + 1).padStart(2, ' ')}. [${t.taskId.padEnd(14, ' ')}] (${t.repository.padEnd(6, ' ')}) : ${statusIcon.padEnd(16, ' ')} | Solved: ${t.solvedTrials}/${t.trialsCount} | Mean Score: ${t.meanScore.toFixed(1)} (σ: ${t.scoreStdDev.toFixed(1)})`
    );
  });

  lines.push(
    '\n========================================================================================\n'
  );
  return lines.join('\n');
}
