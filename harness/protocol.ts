/**
 * TypeBench Standardized Benchmark Protocol Engine
 * Enforces uniform benchmark conditions across different coding agents:
 * identical dataset release, strict timeouts, anti-contamination verification,
 * identical repeated trials, independent evaluation, and deterministic scoring.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyReleaseCheckpoint, DatasetReleaseCheckpoint } from '../dataset/freeze.js';
import { runRepeatedBenchmark, AgentReliabilityReport } from './statistics.js';
import { getAgent } from '../agents/agent-runner.js';

export interface BenchmarkProtocolConfig {
  protocolVersion: string; // e.g. "1.0.0"
  releaseVersion: string;
  releaseCheckpointPath: string;
  expectedFingerprint?: string;
  timeoutSecPerTask: number; // default: 300
  evalTimeoutSec: number; // default: 300
  trialsPerTask: number; // default: 3
  enforceAntiContamination: boolean; // default: true
  scoringWeights: {
    benchmark: number; // 0.70
    typecheck: number; // 0.15
    regression: number; // 0.15
  };
}

export interface AgentProtocolSummary {
  agentName: string;
  passAt1: number; // percentage (0 - 100)
  meanScore: number; // (0 - 100)
  scoreStdDev: number;
  confidenceInterval95: [number, number];
  consistencyRate: number; // percentage (0 - 100)
  flakyTasksCount: number;
  totalDurationMs: number;
  reliabilityReportId: string;
}

export interface ProtocolRunReport {
  protocolRunId: string;
  protocolVersion: string;
  releaseVersion: string;
  datasetFingerprint: string;
  timestamp: string;
  config: BenchmarkProtocolConfig;
  evaluatedAgents: string[];
  totalTasks: number;
  trialsPerAgent: number;
  agentSummaries: Record<string, AgentProtocolSummary>;
}

export interface ProtocolExecutionOptions {
  limit?: number;
  verbose?: boolean;
  tasksDir?: string;
  outputProtocolDir?: string;
}

/**
 * Creates default standardized benchmark protocol configuration.
 */
export function createDefaultProtocolConfig(
  releaseCheckpointPath = 'dataset/releases/v0.2.0.json',
  releaseVersion?: string,
): BenchmarkProtocolConfig {
  let resolvedReleasePath = path.resolve(process.cwd(), releaseCheckpointPath);
  if (!fs.existsSync(resolvedReleasePath)) {
    const version = path
      .basename(releaseCheckpointPath)
      .replace(/^v/, '')
      .replace(/\.json$/, '');
    if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
      const versionedPath = path.resolve(
        process.cwd(),
        'dataset/releases',
        `v${version}.json`,
      );
      if (fs.existsSync(versionedPath)) {
        resolvedReleasePath = versionedPath;
      }
    }
  }

  const resolvedReleaseVersion =
    releaseVersion ||
    (fs.existsSync(resolvedReleasePath)
      ? (JSON.parse(fs.readFileSync(resolvedReleasePath, 'utf-8')) as DatasetReleaseCheckpoint).version
      : '0.2.0');

  return {
    protocolVersion: '1.0.0',
    releaseVersion: resolvedReleaseVersion,
    releaseCheckpointPath: resolvedReleasePath,
    timeoutSecPerTask: 300,
    evalTimeoutSec: 300,
    trialsPerTask: 3,
    enforceAntiContamination: true,
    scoringWeights: {
      benchmark: 0.7,
      typecheck: 0.15,
      regression: 0.15,
    },
  };
}

/**
 * Validates protocol invariants and release checkpoint integrity.
 */
export function validateProtocolInvariants(
  config: BenchmarkProtocolConfig,
  options: { tasksDir?: string } = {}
): { valid: boolean; errors: string[]; release: DatasetReleaseCheckpoint } {
  const errors: string[] = [];
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  const releasePath = path.resolve(process.cwd(), config.releaseCheckpointPath);

  if (!fs.existsSync(releasePath)) {
    return {
      valid: false,
      errors: [`Release checkpoint not found at: ${releasePath}`],
      release: null as any,
    };
  }

  // 1. SHA-256 Release Integrity Verification
  const verification = verifyReleaseCheckpoint(releasePath, { tasksDir });
  if (!verification.valid) {
    errors.push(...verification.errors);
  }

  const release: DatasetReleaseCheckpoint = JSON.parse(
    fs.readFileSync(releasePath, 'utf-8')
  );

  if (
    config.expectedFingerprint &&
    config.expectedFingerprint !== release.datasetFingerprint
  ) {
    errors.push(
      `Dataset fingerprint mismatch! Expected: ${config.expectedFingerprint}, Found: ${release.datasetFingerprint}`
    );
  }

  // 2. Anti-Contamination Verification
  if (config.enforceAntiContamination) {
    for (const task of release.tasks) {
      const promptPath = path.join(tasksDir, task.taskId, 'prompt.md');
      if (fs.existsSync(promptPath)) {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        // Assert prompt does not leak base commit SHA
        if (promptContent.includes(task.baseCommit)) {
          errors.push(
            `Contamination detected: prompt.md in task ${task.taskId} leaks baseCommit SHA!`
          );
        }
      }
    }
  }

  // 3. Weight sanity check
  const totalWeight =
    config.scoringWeights.benchmark +
    config.scoringWeights.typecheck +
    config.scoringWeights.regression;
  if (Math.abs(totalWeight - 1.0) > 0.001) {
    errors.push(
      `Scoring weights must sum to 1.0, current sum is ${totalWeight.toFixed(3)}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    release,
  };
}

/**
 * Executes a standardized benchmark protocol across one or more coding agents.
 */
export async function executeBenchmarkProtocol(
  config: BenchmarkProtocolConfig,
  agentNames: string[],
  options: ProtocolExecutionOptions = {}
): Promise<ProtocolRunReport> {
  const outputProtocolDir =
    options.outputProtocolDir ??
    path.resolve(process.cwd(), 'results/protocol-runs');
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');

  console.log(`\n========================================================================================`);
  console.log(`[TypeBench] Standardized Benchmark Protocol Execution (Protocol v${config.protocolVersion})`);
  console.log(`========================================================================================`);
  console.log(`Release Checkpoint : ${config.releaseCheckpointPath}`);
  console.log(`Target Agents      : ${agentNames.join(', ')}`);
  console.log(`Trials Per Task    : ${config.trialsPerTask}`);
  console.log(`Task Timeout       : ${config.timeoutSecPerTask}s`);
  console.log(`Scoring Weights    : ${config.scoringWeights.benchmark * 100}% benchmark / ${config.scoringWeights.typecheck * 100}% typecheck / ${config.scoringWeights.regression * 100}% regression\n`);

  // Step 1: Pre-Execution Protocol Validation Gate
  console.log(`[Protocol] Verifying benchmark protocol invariants...`);
  const invariantCheck = validateProtocolInvariants(config, { tasksDir });
  if (!invariantCheck.valid) {
    throw new Error(
      `Protocol Invariant Check Failed!\nErrors:\n  - ${invariantCheck.errors.join('\n  - ')}`
    );
  }
  console.log(`[Protocol] Invariants verified: 🛡️  [PASSED / IMMUTABLE]`);
  console.log(`[Protocol] Dataset Fingerprint: ${invariantCheck.release.datasetFingerprint}\n`);

  // Step 2: Validate Agent Availability
  for (const name of agentNames) {
    const agentInstance = getAgent(name);
    if (!agentInstance) {
      throw new Error(`Target agent "${name}" is not registered in the agent registry!`);
    }
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const protocolRunId = `protocol_v${config.protocolVersion}_${dateStr}_${Date.now().toString(36)}`;
  const agentSummaries: Record<string, AgentProtocolSummary> = {};

  // Step 3: Run Repeated Benchmark Protocol for Each Agent Under Identical Invariants
  for (let a = 0; a < agentNames.length; a++) {
    const agentName = agentNames[a];

    console.log(`========================================================================================`);
    console.log(`[Agent ${a + 1}/${agentNames.length}] Executing Benchmark Protocol for: ${agentName}`);
    console.log(`========================================================================================\n`);

    const reliabilityReport: AgentReliabilityReport = await runRepeatedBenchmark(
      config.releaseCheckpointPath,
      agentName,
      {
        trials: config.trialsPerTask,
        timeoutSec: config.timeoutSecPerTask,
        limit: options.limit,
        verbose: options.verbose,
        tasksDir,
      }
    );

    agentSummaries[agentName] = {
      agentName,
      passAt1: reliabilityReport.passAt1,
      meanScore: reliabilityReport.meanScore,
      scoreStdDev: reliabilityReport.scoreStdDev,
      confidenceInterval95: reliabilityReport.confidenceInterval95,
      consistencyRate: reliabilityReport.consistencyRate,
      flakyTasksCount: reliabilityReport.flakyTasksCount,
      totalDurationMs: reliabilityReport.totalDurationMs,
      reliabilityReportId: reliabilityReport.reportId,
    };
  }

  const report: ProtocolRunReport = {
    protocolRunId,
    protocolVersion: config.protocolVersion,
    releaseVersion: config.releaseVersion,
    datasetFingerprint: invariantCheck.release.datasetFingerprint,
    timestamp: new Date().toISOString(),
    config,
    evaluatedAgents: agentNames,
    totalTasks: options.limit
      ? Math.min(options.limit, invariantCheck.release.tasks.length)
      : invariantCheck.release.tasks.length,
    trialsPerAgent: config.trialsPerTask,
    agentSummaries,
  };

  // Step 4: Persist Protocol Run Report
  fs.mkdirSync(outputProtocolDir, { recursive: true });
  const reportPath = path.join(outputProtocolDir, `${protocolRunId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`[TypeBench] Standardized protocol report saved to: ${reportPath}\n`);

  return report;
}

/**
 * Formats a terminal-friendly comparison table across all agents evaluated under the protocol.
 */
export function formatProtocolReportSummary(report: ProtocolRunReport): string {
  const lines: string[] = [];

  lines.push(
    '========================================================================================'
  );
  lines.push(
    `TYPEBENCH STANDARDIZED BENCHMARK PROTOCOL REPORT (Protocol v${report.protocolVersion})`
  );
  lines.push(
    '========================================================================================\n'
  );

  lines.push(`Protocol Run ID     : ${report.protocolRunId}`);
  lines.push(`Dataset Release     : v${report.releaseVersion}`);
  lines.push(`Dataset Fingerprint : ${report.datasetFingerprint}`);
  lines.push(`Evaluated Agents    : ${report.evaluatedAgents.join(', ')}`);
  lines.push(`Tasks in Suite      : ${report.totalTasks}`);
  lines.push(`Trials Per Agent    : ${report.trialsPerAgent} independent trials\n`);

  lines.push(
    `| Agent Name       | Pass@1 (%) | Mean Score (0-100) | Score StdDev (σ) | 95% Confidence Interval | Consistency | Flaky Tasks |`
  );
  lines.push(
    `| ---------------- | ---------- | ------------------ | ---------------- | ----------------------- | ----------- | ----------- |`
  );

  for (const agentName of report.evaluatedAgents) {
    const s = report.agentSummaries[agentName];
    if (s) {
      const passStr = `${s.passAt1.toFixed(1)}%`.padEnd(10, ' ');
      const meanStr = `${s.meanScore.toFixed(1)}/100`.padEnd(18, ' ');
      const stdStr = `±${s.scoreStdDev.toFixed(2)}`.padEnd(16, ' ');
      const ciStr = `[${s.confidenceInterval95[0]}, ${s.confidenceInterval95[1]}]`.padEnd(23, ' ');
      const consStr = `${s.consistencyRate.toFixed(1)}%`.padEnd(11, ' ');
      const flakyStr = `${s.flakyTasksCount}`.padEnd(11, ' ');

      lines.push(
        `| ${agentName.padEnd(16, ' ')} | ${passStr} | ${meanStr} | ${stdStr} | ${ciStr} | ${consStr} | ${flakyStr} |`
      );
    }
  }

  lines.push(
    '\n========================================================================================\n'
  );
  return lines.join('\n');
}
