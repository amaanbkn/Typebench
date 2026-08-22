/**
 * TypeBench Multi-Agent Session Engine
 * Executes multiple AI coding agents across benchmark task suites under identical conditions,
 * evaluating results, computing deterministic scores, and generating comparative performance matrices.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeAgentOnTask } from '../agents/agent-runner.js';
import { evaluateRun } from '../evaluator/evaluator.js';
import { scoreRun, ScoreResult } from '../scoring/scorer.js';

export interface AgentTaskOutcome {
  taskId: string;
  runId: string;
  status: string;
  score: number | null;
  maxScore: number;
  isAvailable: boolean;
  durationMs: number;
}

export interface AgentBenchmarkStats {
  agentName: string;
  totalTasks: number;
  evaluatedTasks: number;
  solvedTasks: number;
  failedTasks: number;
  infrastructureFailures: number;
  passRate: number; // percentage (0 - 100)
  meanScore: number; // average score among available tasks
  totalDurationMs: number;
  tasks: Record<string, AgentTaskOutcome>;
}

export interface BenchmarkSessionResult {
  sessionId: string;
  timestamp: string;
  taskIds: string[];
  agentNames: string[];
  agents: Record<string, AgentBenchmarkStats>;
  durationMs: number;
}

export interface SessionOptions {
  timeoutSec?: number;
  verbose?: boolean;
  outputDir?: string;
  sessionId?: string;
}

/**
 * Executes a full multi-agent benchmark session across a task set.
 */
export async function runBenchmarkSession(
  taskPaths: string[],
  agentNames: string[],
  options: SessionOptions = {}
): Promise<BenchmarkSessionResult> {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().slice(0, 10);
  const sessionId =
    options.sessionId ?? `typebench_${dateStr}_${Date.now().toString(36)}`;
  const outputDir =
    options.outputDir ?? path.resolve(process.cwd(), 'results/comparisons');

  const resolvedTaskPaths = taskPaths.map((p) => {
    let resolved = path.resolve(process.cwd(), p);
    if (!fs.existsSync(resolved)) {
      const candidate = path.resolve(process.cwd(), 'tasks', p);
      if (fs.existsSync(candidate)) resolved = candidate;
    }
    return resolved;
  });

  const taskIds = resolvedTaskPaths.map((p) => path.basename(p));

  console.log(`\n========================================`);
  console.log(`[TypeBench] Starting Benchmark Session`);
  console.log(`========================================`);
  console.log(`Session ID : ${sessionId}`);
  console.log(`Tasks (${taskIds.length})   : ${taskIds.join(', ')}`);
  console.log(`Agents (${agentNames.length})  : ${agentNames.join(', ')}\n`);

  // Initialize stats per agent
  const agentStatsMap: Record<string, AgentBenchmarkStats> = {};
  for (const agent of agentNames) {
    agentStatsMap[agent] = {
      agentName: agent,
      totalTasks: taskIds.length,
      evaluatedTasks: 0,
      solvedTasks: 0,
      failedTasks: 0,
      infrastructureFailures: 0,
      passRate: 0,
      meanScore: 0,
      totalDurationMs: 0,
      tasks: {},
    };
  }

  // Execute Matrix: Tasks x Agents
  for (let t = 0; t < resolvedTaskPaths.length; t++) {
    const taskPath = resolvedTaskPaths[t];
    const taskId = taskIds[t];

    console.log(`----------------------------------------`);
    console.log(`[Task ${t + 1}/${taskIds.length}] ${taskId}`);
    console.log(`----------------------------------------`);

    for (let a = 0; a < agentNames.length; a++) {
      const agentName = agentNames[a];
      console.log(`-> Running agent [${agentName}] on task [${taskId}]...`);

      // 1. Agent Execution
      const agentResult = await executeAgentOnTask(taskPath, agentName, {
        timeoutSec: options.timeoutSec ?? 300,
        verbose: options.verbose ?? false,
      });

      // 2. Independent Evaluation
      const evalResult = await evaluateRun(agentResult.runId, {
        timeoutSec: options.timeoutSec ?? 300,
        verbose: options.verbose ?? false,
      });

      // 3. Deterministic Scoring
      const scoreResult = scoreRun(evalResult.runId, {
        verbose: options.verbose ?? false,
      });

      // Record task outcome
      const outcome: AgentTaskOutcome = {
        taskId,
        runId: scoreResult.runId,
        status: scoreResult.status,
        score: scoreResult.score,
        maxScore: scoreResult.maxScore,
        isAvailable: scoreResult.isAvailable,
        durationMs: agentResult.durationMs + evalResult.durationMs,
      };

      const stats = agentStatsMap[agentName];
      stats.tasks[taskId] = outcome;
      stats.totalDurationMs += outcome.durationMs;

      if (scoreResult.isAvailable) {
        stats.evaluatedTasks++;
        if (scoreResult.status === 'solved') {
          stats.solvedTasks++;
        } else {
          stats.failedTasks++;
        }
      } else {
        stats.infrastructureFailures++;
      }

      const scoreDisplay =
        scoreResult.score !== null ? `${scoreResult.score}/${scoreResult.maxScore}` : 'Unavailable';
      console.log(
        `   Result: ${scoreResult.status.toUpperCase()} | Score: ${scoreDisplay} | Duration: ${(outcome.durationMs / 1000).toFixed(1)}s`
      );
    }
  }

  // Compute final summary rates per agent
  for (const agent of agentNames) {
    const stats = agentStatsMap[agent];
    if (stats.evaluatedTasks > 0) {
      stats.passRate = parseFloat(
        ((stats.solvedTasks / stats.evaluatedTasks) * 100).toFixed(1)
      );

      const totalValidScore = Object.values(stats.tasks)
        .filter((t) => t.isAvailable && t.score !== null)
        .reduce((sum, t) => sum + (t.score || 0), 0);

      stats.meanScore = parseFloat((totalValidScore / stats.evaluatedTasks).toFixed(1));
    }
  }

  const sessionResult: BenchmarkSessionResult = {
    sessionId,
    timestamp: new Date().toISOString(),
    taskIds,
    agentNames,
    agents: agentStatsMap,
    durationMs: Date.now() - startTime,
  };

  // Persist session comparison result
  fs.mkdirSync(outputDir, { recursive: true });
  const sessionFilePath = path.join(outputDir, `${sessionId}.json`);
  fs.writeFileSync(sessionFilePath, JSON.stringify(sessionResult, null, 2), 'utf-8');

  console.log(`\n[TypeBench] Session report saved to: ${sessionFilePath}\n`);

  return sessionResult;
}

/**
 * Formats a terminal-friendly comparison summary table.
 */
export function formatComparisonSummary(session: BenchmarkSessionResult): string {
  const lines: string[] = [];

  lines.push('========================================================================================');
  lines.push(`TYPEBENCH MULTI-AGENT COMPARISON SUMMARY (Session: ${session.sessionId})`);
  lines.push('========================================================================================\n');

  // Overview Table Header
  lines.push(
    `| Agent Name           | Tasks | Evaluated | Solved | Failed | Infra Fail | Pass Rate | Mean Score | Duration |`
  );
  lines.push(
    `| -------------------- | ----- | --------- | ------ | ------ | ---------- | --------- | ---------- | -------- |`
  );

  for (const agentName of session.agentNames) {
    const s = session.agents[agentName];
    const namePad = s.agentName.padEnd(20, ' ');
    const tasksPad = String(s.totalTasks).padStart(5, ' ');
    const evalPad = String(s.evaluatedTasks).padStart(9, ' ');
    const solvedPad = String(s.solvedTasks).padStart(6, ' ');
    const failedPad = String(s.failedTasks).padStart(6, ' ');
    const infraPad = String(s.infrastructureFailures).padStart(10, ' ');
    const passRatePad = `${s.passRate.toFixed(1)}%`.padStart(9, ' ');
    const meanScorePad = `${s.meanScore.toFixed(1)}`.padStart(10, ' ');
    const durationPad = `${(s.totalDurationMs / 1000).toFixed(1)}s`.padStart(8, ' ');

    lines.push(
      `| ${namePad} | ${tasksPad} | ${evalPad} | ${solvedPad} | ${failedPad} | ${infraPad} | ${passRatePad} | ${meanScorePad} | ${durationPad} |`
    );
  }

  lines.push('\n----------------------------------------------------------------------------------------');
  lines.push('TASK-BY-TASK SCORE BREAKDOWN');
  lines.push('----------------------------------------------------------------------------------------\n');

  for (const taskId of session.taskIds) {
    lines.push(`Task: ${taskId}`);
    for (const agentName of session.agentNames) {
      const outcome = session.agents[agentName]?.tasks[taskId];
      if (outcome) {
        const scoreStr = outcome.score !== null ? `${outcome.score}/${outcome.maxScore}` : 'Unavailable';
        const icon =
          outcome.status === 'solved'
            ? '🌟'
            : outcome.status === 'failed'
            ? '❌'
            : outcome.status === 'infrastructure_failure'
            ? '⚠️ '
            : '❓';
        lines.push(
          `  - ${agentName.padEnd(16, ' ')} : ${icon} ${outcome.status.toUpperCase().padEnd(22, ' ')} | Score: ${scoreStr.padEnd(8, ' ')} | (${(outcome.durationMs / 1000).toFixed(1)}s)`
        );
      }
    }
    lines.push('');
  }

  lines.push('========================================================================================\n');
  return lines.join('\n');
}
