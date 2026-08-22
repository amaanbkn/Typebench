/**
 * TypeBench Task Readiness & Reproducibility Validator
 * Evaluates benchmark tasks against reproducibility criteria inside isolated environments,
 * classifying tasks into 'ready', 'needs-review', or 'rejected'.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runTaskInSandbox, SandboxResult } from '../harness/src/docker/sandbox-runner.js';
import { compileManifest } from './builder.js';

export type TaskReadinessStatus = 'ready' | 'needs-review' | 'rejected';

export interface ReadinessCheckResult {
  taskId: string;
  previousStatus: string;
  status: TaskReadinessStatus;
  checks: {
    schemaValid: boolean;
    baseCommitResolves: boolean;
    antiContamination: boolean;
    testCommandConfigured: boolean;
    sandboxExecutable: boolean;
  };
  reasons: string[];
  durationMs: number;
  timestamp: string;
}

export interface DatasetReadinessSummary {
  totalTasks: number;
  readyCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  tasks: Record<string, ReadinessCheckResult>;
  durationMs: number;
}

export interface ReadinessOptions {
  runSandbox?: boolean;
  timeoutSec?: number;
  updateTaskFiles?: boolean;
  tasksDir?: string;
  verbose?: boolean;
}

/**
 * Validates the benchmark readiness of a single task.
 */
export async function checkTaskReadiness(
  taskPathOrId: string,
  options: ReadinessOptions = {}
): Promise<ReadinessCheckResult> {
  const startTime = Date.now();
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  let taskFolder = path.resolve(process.cwd(), taskPathOrId);

  if (!fs.existsSync(taskFolder) || !fs.statSync(taskFolder).isDirectory()) {
    const candidate = path.join(tasksDir, taskPathOrId);
    if (fs.existsSync(candidate)) {
      taskFolder = candidate;
    }
  }

  const taskId = path.basename(taskFolder);
  const taskJsonPath = path.join(taskFolder, 'task.json');
  const metaJsonPath = path.join(taskFolder, 'metadata.json');
  const promptPath = path.join(taskFolder, 'prompt.md');

  const checks = {
    schemaValid: false,
    baseCommitResolves: false,
    antiContamination: false,
    testCommandConfigured: false,
    sandboxExecutable: false,
  };
  const reasons: string[] = [];
  let previousStatus = 'unknown';

  // 1. Schema Integrity Check
  if (!fs.existsSync(taskJsonPath)) {
    reasons.push('Missing task.json definition');
    return {
      taskId,
      previousStatus,
      status: 'rejected',
      checks,
      reasons,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  let taskConfig: any;
  try {
    taskConfig = JSON.parse(fs.readFileSync(taskJsonPath, 'utf-8'));
    previousStatus = taskConfig.taskStatus || 'unknown';
    checks.schemaValid = Boolean(
      taskConfig.taskId && taskConfig.repositoryUrl && taskConfig.baseCommit && taskConfig.testCommand
    );
  } catch (err: any) {
    reasons.push(`task.json JSON parse error: ${err.message || String(err)}`);
    return {
      taskId,
      previousStatus,
      status: 'rejected',
      checks,
      reasons,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (!checks.schemaValid) {
    reasons.push('task.json is missing required fields (taskId, repositoryUrl, baseCommit, testCommand)');
  }

  // 2. Base Commit Format Check
  if (taskConfig.baseCommit && /^[0-9a-f]{7,40}$/i.test(taskConfig.baseCommit)) {
    checks.baseCommitResolves = true;
  } else {
    reasons.push(`Invalid baseCommit hash: ${taskConfig.baseCommit}`);
  }

  // 3. Test Command Configuration
  if (taskConfig.testCommand && taskConfig.testCommand.trim().length > 3) {
    checks.testCommandConfigured = true;
  } else {
    reasons.push('Test command is missing or empty');
  }

  // 4. Anti-Contamination Check
  if (fs.existsSync(promptPath)) {
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    if (promptContent.includes(taskConfig.baseCommit)) {
      reasons.push('prompt.md contains raw base commit SHA (contamination risk)');
    } else {
      checks.antiContamination = true;
    }
  } else {
    reasons.push('Missing prompt.md');
  }

  // 5. Sandbox Execution (Optional / if requested)
  if (options.runSandbox) {
    try {
      const sandboxResult: SandboxResult = await runTaskInSandbox(taskFolder, {
        timeoutSec: options.timeoutSec ?? 180,
        verbose: options.verbose ?? false,
      });

      if (sandboxResult.status === 'passed' || sandboxResult.status === 'failed') {
        checks.sandboxExecutable = true;
      } else if (sandboxResult.status === 'infrastructure_failure') {
        reasons.push(`Sandbox infrastructure limitation: ${sandboxResult.error}`);
      } else {
        reasons.push(`Sandbox execution failed: ${sandboxResult.status} (${sandboxResult.error || ''})`);
      }
    } catch (err: any) {
      reasons.push(`Sandbox error: ${err.message || String(err)}`);
    }
  } else {
    // If sandbox not executed, mark as executable if structural checks pass
    checks.sandboxExecutable = checks.schemaValid && checks.baseCommitResolves;
  }

  // Determine Final Readiness Status
  let status: TaskReadinessStatus = 'ready';

  if (!checks.schemaValid || !checks.baseCommitResolves || !checks.antiContamination || !checks.testCommandConfigured) {
    status = 'rejected';
  } else if (!checks.sandboxExecutable || reasons.some((r) => r.includes('infrastructure') || r.includes('limitations'))) {
    status = 'needs-review';
  } else if (previousStatus === 'needs-review' && !options.runSandbox) {
    // Retain needs-review until container validation is run
    status = 'needs-review';
  }

  // Update task files if requested
  if (options.updateTaskFiles) {
    taskConfig.taskStatus = status;
    fs.writeFileSync(taskJsonPath, JSON.stringify(taskConfig, null, 2), 'utf-8');

    if (fs.existsSync(metaJsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8'));
        meta.taskStatus = status;
        fs.writeFileSync(metaJsonPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {
        // ignore
      }
    }
  }

  return {
    taskId,
    previousStatus,
    status,
    checks,
    reasons,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validates readiness across the entire dataset manifest.
 */
export async function checkDatasetReadiness(
  manifestPath = path.resolve(process.cwd(), 'dataset/manifest.json'),
  options: ReadinessOptions = {}
): Promise<DatasetReadinessSummary> {
  const startTime = Date.now();
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');

  if (!fs.existsSync(manifestPath)) {
    compileManifest(tasksDir, manifestPath);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const taskMap: Record<string, ReadinessCheckResult> = {};

  let readyCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;

  console.log(`\n========================================`);
  console.log(`[TypeBench] Validating Dataset Readiness`);
  console.log(`========================================`);
  console.log(`Tasks: ${manifest.tasks.length} total\n`);

  for (let i = 0; i < manifest.tasks.length; i++) {
    const taskEntry = manifest.tasks[i];
    const taskId = taskEntry.taskId;
    const taskFolder = path.join(tasksDir, taskId);

    const result = await checkTaskReadiness(taskFolder, options);
    taskMap[taskId] = result;

    if (result.status === 'ready') readyCount++;
    else if (result.status === 'needs-review') needsReviewCount++;
    else rejectedCount++;

    const icon =
      result.status === 'ready'
        ? '🌟 [READY]'
        : result.status === 'needs-review'
        ? '⚠️  [NEEDS-REVIEW]'
        : '❌ [REJECTED]';

    console.log(
      `  [${i + 1}/${manifest.tasks.length}] ${taskId.padEnd(16, ' ')} : ${icon} (was: ${result.previousStatus})`
    );
  }

  // Re-synchronize manifest if files were updated
  if (options.updateTaskFiles) {
    compileManifest(tasksDir, manifestPath);
    console.log(`\n[TypeBench] Manifest re-synchronized at: ${manifestPath}`);
  }

  return {
    totalTasks: manifest.tasks.length,
    readyCount,
    needsReviewCount,
    rejectedCount,
    tasks: taskMap,
    durationMs: Date.now() - startTime,
  };
}
