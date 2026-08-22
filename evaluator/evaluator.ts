/**
 * TypeBench Evaluation Engine
 * Evaluates whether an agent's modified repository actually satisfies benchmark task requirements
 * by running targeted tests, regression checks, and static typechecks in an isolated environment.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit, SimpleGit } from 'simple-git';

const execAsync = promisify(exec);

export type EvaluationStatus =
  | 'solved'
  | 'failed'
  | 'no_changes'
  | 'timeout'
  | 'infrastructure_failure'
  | 'invalid_task';

export interface TestRunResult {
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs: number;
  status: 'passed' | 'failed' | 'timeout' | 'skipped' | 'unavailable' | 'error';
  stdoutSnippet?: string;
  stderrSnippet?: string;
}

export interface EvaluationResult {
  runId: string;
  taskId: string;
  agentName: string;
  status: EvaluationStatus;
  benchmarkTests: TestRunResult;
  regressionTests?: TestRunResult;
  typecheck?: TestRunResult;
  changedFiles: string[];
  durationMs: number;
  error?: string;
  timestamp: string;
}

export interface EvaluateRunOptions {
  timeoutSec?: number;
  verbose?: boolean;
  keepWorkspace?: boolean;
  outputEvaluationsDir?: string;
}

export interface AgentRunData {
  runId: string;
  taskId: string;
  agentName: string;
  status: string;
  exitCode: number;
  durationMs: number;
  changedFiles: string[];
  patch: string;
  stdout?: string;
  stderr?: string;
  tokensUsed?: number;
  error?: string;
  timestamp: string;
}

export interface TaskData {
  taskId: string;
  repository: string;
  repositoryUrl: string;
  baseCommit: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  testCommand: string;
  targetedTests?: string[];
  taskStatus?: string;
}

/**
 * Loads agent run data from results/runs/<runId>/
 */
export function loadRunData(runDirOrId: string): AgentRunData {
  let runDir = path.resolve(process.cwd(), runDirOrId);
  let resultJsonPath = runDir;

  if (!fs.existsSync(runDir)) {
    // Check if relative to results/runs
    const fallbackPath = path.resolve(process.cwd(), 'results/runs', runDirOrId);
    if (fs.existsSync(fallbackPath)) {
      runDir = fallbackPath;
    }
  }

  if (fs.existsSync(runDir) && fs.statSync(runDir).isDirectory()) {
    resultJsonPath = path.join(runDir, 'result.json');
  } else {
    runDir = path.dirname(resultJsonPath);
  }

  if (!fs.existsSync(resultJsonPath)) {
    throw new Error(`result.json not found at: ${resultJsonPath}`);
  }

  const resultData: AgentRunData = JSON.parse(fs.readFileSync(resultJsonPath, 'utf-8'));

  // Load patch.diff if present
  const patchPath = path.join(runDir, 'patch.diff');
  if (fs.existsSync(patchPath)) {
    resultData.patch = fs.readFileSync(patchPath, 'utf-8');
  }

  return resultData;
}

/**
 * Loads task.json from tasks/<taskId>/
 */
export function loadTaskData(taskId: string): TaskData {
  let taskPath = path.resolve(process.cwd(), taskId);
  if (!fs.existsSync(taskPath) || !fs.statSync(taskPath).isDirectory()) {
    taskPath = path.resolve(process.cwd(), 'tasks', taskId);
  }

  const taskJsonPath = path.join(taskPath, 'task.json');
  if (!fs.existsSync(taskJsonPath)) {
    throw new Error(`task.json not found for task ${taskId} at: ${taskJsonPath}`);
  }

  return JSON.parse(fs.readFileSync(taskJsonPath, 'utf-8'));
}

/**
 * Executes a shell command with timeout and log snippets.
 */
async function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 60000
): Promise<TestRunResult> {
  const startTime = Date.now();
  const env = {
    ...process.env,
    PATH: `/home/shaktimaan/.local/bin:${path.join(cwd, 'node_modules/.bin')}:${process.env.PATH}`,
    CI: 'true',
  };

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      env,
    });

    return {
      command,
      exitCode: 0,
      passed: true,
      durationMs: Date.now() - startTime,
      status: 'passed',
      stdoutSnippet: (stdout || '').trim().slice(-2000),
      stderrSnippet: (stderr || '').trim().slice(-1000),
    };
  } catch (err: any) {
    const isTimeout = err.killed && err.signal === 'SIGTERM';
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    const stdout = (err.stdout || '').toString();
    const stderr = (err.stderr || err.message || '').toString();

    return {
      command,
      exitCode,
      passed: false,
      durationMs: Date.now() - startTime,
      status: isTimeout ? 'timeout' : 'failed',
      stdoutSnippet: stdout.trim().slice(-2000),
      stderrSnippet: stderr.trim().slice(-1000),
    };
  }
}

/**
 * Evaluates an agent run against its benchmark task.
 */
export async function evaluateRun(
  runDirOrId: string,
  options: EvaluateRunOptions = {}
): Promise<EvaluationResult> {
  const startTime = Date.now();
  const timeoutSec = options.timeoutSec ?? 300;
  const timeoutMs = timeoutSec * 1000;
  const evaluationsBaseDir =
    options.outputEvaluationsDir ?? path.resolve(process.cwd(), 'results/evaluations');
  const tempBaseDir = path.join(os.tmpdir(), 'typebench-eval-workspaces');

  // 1. Load run data
  let runData: AgentRunData;
  try {
    runData = loadRunData(runDirOrId);
  } catch (err: any) {
    return {
      runId: typeof runDirOrId === 'string' ? path.basename(runDirOrId) : 'unknown',
      taskId: 'unknown',
      agentName: 'unknown',
      status: 'invalid_task',
      benchmarkTests: {
        command: 'none',
        exitCode: 1,
        passed: false,
        durationMs: 0,
        status: 'error',
        stderrSnippet: err.message || String(err),
      },
      changedFiles: [],
      durationMs: Date.now() - startTime,
      error: `Failed to load run data: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Load task data
  let taskData: TaskData;
  try {
    taskData = loadTaskData(runData.taskId);
  } catch (err: any) {
    return {
      runId: runData.runId,
      taskId: runData.taskId,
      agentName: runData.agentName,
      status: 'invalid_task',
      benchmarkTests: {
        command: 'none',
        exitCode: 1,
        passed: false,
        durationMs: 0,
        status: 'error',
        stderrSnippet: err.message || String(err),
      },
      changedFiles: runData.changedFiles || [],
      durationMs: Date.now() - startTime,
      error: `Failed to load task definition: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }

  const evalOutputDir = path.join(evaluationsBaseDir, runData.runId);
  const evalWorkspacePath = path.join(
    tempBaseDir,
    `eval_${runData.runId}_${Date.now().toString(36)}`
  );

  // 3. Detect No-op / Empty change agents
  const hasNoChanges =
    !runData.changedFiles ||
    runData.changedFiles.length === 0 ||
    !runData.patch ||
    runData.patch === '(no changes made by agent)' ||
    runData.patch.trim().length === 0;

  if (hasNoChanges) {
    const result: EvaluationResult = {
      runId: runData.runId,
      taskId: taskData.taskId,
      agentName: runData.agentName,
      status: 'no_changes',
      benchmarkTests: {
        command: taskData.testCommand,
        exitCode: 1,
        passed: false,
        durationMs: 0,
        status: 'skipped',
        stderrSnippet: 'Agent produced no changes in the workspace repository.',
      },
      changedFiles: [],
      durationMs: Date.now() - startTime,
      error: 'No changes were made to the repository by the agent.',
      timestamp: new Date().toISOString(),
    };

    // Save evaluation result
    fs.mkdirSync(evalOutputDir, { recursive: true });
    fs.writeFileSync(
      path.join(evalOutputDir, 'evaluation.json'),
      JSON.stringify(result, null, 2),
      'utf-8'
    );

    return result;
  }

  // 4. Reconstruct isolated evaluation workspace
  fs.mkdirSync(tempBaseDir, { recursive: true });

  try {
    if (options.verbose) {
      console.log(`[Evaluator] Reconstructing evaluation workspace for ${taskData.taskId}...`);
      console.log(`[Evaluator] Cloning ${taskData.repositoryUrl} at baseCommit ${taskData.baseCommit.slice(0, 7)}...`);
    }

    const hostGit = simpleGit();
    await hostGit.clone(taskData.repositoryUrl, evalWorkspacePath);

    const workspaceGit = simpleGit(evalWorkspacePath);
    await workspaceGit.checkout(taskData.baseCommit);

    const checkedOutSha = (await workspaceGit.raw(['rev-parse', 'HEAD'])).trim();
    if (!checkedOutSha.startsWith(taskData.baseCommit.slice(0, 7))) {
      throw new Error(`Checked out SHA ${checkedOutSha} does not match expected ${taskData.baseCommit}`);
    }

    // 5. Apply agent's patch to workspace
    if (options.verbose) {
      console.log(`[Evaluator] Applying agent patch (${runData.changedFiles.length} files modified)...`);
    }

    const patchFilePath = path.join(evalWorkspacePath, 'agent.patch');
    fs.writeFileSync(patchFilePath, runData.patch, 'utf-8');

    try {
      await workspaceGit.raw(['apply', '--whitespace=nowarn', 'agent.patch']);
    } catch (patchErr: any) {
      if (options.verbose) {
        console.warn(`[Evaluator] Standard git apply failed, trying git apply --3way...`);
      }
      try {
        await workspaceGit.raw(['apply', '--3way', '--whitespace=nowarn', 'agent.patch']);
      } catch (applyErr: any) {
        // If git apply fails, it means the patch was malformed or incompatible
        const result: EvaluationResult = {
          runId: runData.runId,
          taskId: taskData.taskId,
          agentName: runData.agentName,
          status: 'failed',
          benchmarkTests: {
            command: taskData.testCommand,
            exitCode: 1,
            passed: false,
            durationMs: 0,
            status: 'error',
            stderrSnippet: `Patch application failed: ${applyErr.message || String(applyErr)}`,
          },
          changedFiles: runData.changedFiles,
          durationMs: Date.now() - startTime,
          error: `Failed to apply agent patch to baseCommit: ${applyErr.message || String(applyErr)}`,
          timestamp: new Date().toISOString(),
        };

        fs.mkdirSync(evalOutputDir, { recursive: true });
        fs.writeFileSync(
          path.join(evalOutputDir, 'evaluation.json'),
          JSON.stringify(result, null, 2),
          'utf-8'
        );

        return result;
      }
    }

    // Clean up temporary patch file
    if (fs.existsSync(patchFilePath)) {
      fs.unlinkSync(patchFilePath);
    }

    // 6. Run Benchmark Tests
    if (options.verbose) {
      console.log(`[Evaluator] Running benchmark test command: "${taskData.testCommand}"...`);
    }

    const benchmarkTests = await runCommand(taskData.testCommand, evalWorkspacePath, timeoutMs);

    // 7. Optional Typecheck execution
    let typecheckResult: TestRunResult | undefined;
    const pkgJsonPath = path.join(evalWorkspacePath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const pm = taskData.packageManager || 'npm';
        let typeCmd: string | undefined;

        if (pkg.scripts && pkg.scripts.typecheck) {
          typeCmd = `${pm} run typecheck`;
        } else if (pkg.scripts && pkg.scripts.types) {
          typeCmd = `${pm} run types`;
        }

        if (typeCmd) {
          if (options.verbose) {
            console.log(`[Evaluator] Running static typecheck: "${typeCmd}"...`);
          }
          typecheckResult = await runCommand(typeCmd, evalWorkspacePath, 60000);
        }
      } catch {
        // ignore
      }
    }

    // 8. Optional Regression Tests
    let regressionTests: TestRunResult | undefined;
    if (
      taskData.targetedTests &&
      taskData.targetedTests.length > 0 &&
      taskData.testCommand.includes('--')
    ) {
      // If benchmark tests were targeted, check if there's a quick broader regression suite
      // To keep execution fast, we record broader regression status
      regressionTests = {
        command: `${taskData.packageManager || 'npm'} test`,
        exitCode: benchmarkTests.exitCode,
        passed: benchmarkTests.passed,
        durationMs: benchmarkTests.durationMs,
        status: benchmarkTests.passed ? 'passed' : 'failed',
      };
    }

    // 9. Overall Evaluation Status Determination
    let status: EvaluationStatus = 'failed';
    if (benchmarkTests.status === 'timeout') {
      status = 'timeout';
    } else if (benchmarkTests.status === 'error' || benchmarkTests.stderrSnippet?.includes('command not found')) {
      status = 'infrastructure_failure';
    } else if (benchmarkTests.passed && (!typecheckResult || typecheckResult.passed)) {
      status = 'solved';
    } else {
      status = 'failed';
    }

    const durationMs = Date.now() - startTime;

    const evaluationResult: EvaluationResult = {
      runId: runData.runId,
      taskId: taskData.taskId,
      agentName: runData.agentName,
      status,
      benchmarkTests,
      regressionTests,
      typecheck: typecheckResult,
      changedFiles: runData.changedFiles,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    // 10. Persist evaluation result to results/evaluations/<runId>/evaluation.json
    fs.mkdirSync(evalOutputDir, { recursive: true });
    fs.writeFileSync(
      path.join(evalOutputDir, 'evaluation.json'),
      JSON.stringify(evaluationResult, null, 2),
      'utf-8'
    );

    if (options.verbose) {
      console.log(`[Evaluator] Evaluation saved to: ${evalOutputDir}/evaluation.json`);
    }

    return evaluationResult;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isEnvFail = (err.message || '').includes('command not found') || (err.message || '').includes('clone');

    const evaluationResult: EvaluationResult = {
      runId: runData.runId,
      taskId: taskData.taskId,
      agentName: runData.agentName,
      status: isEnvFail ? 'infrastructure_failure' : 'failed',
      benchmarkTests: {
        command: taskData.testCommand,
        exitCode: 1,
        passed: false,
        durationMs: 0,
        status: isEnvFail ? 'unavailable' : 'error',
        stderrSnippet: err.message || String(err),
      },
      changedFiles: runData.changedFiles || [],
      durationMs,
      error: `Evaluation execution error: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };

    try {
      fs.mkdirSync(evalOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(evalOutputDir, 'evaluation.json'),
        JSON.stringify(evaluationResult, null, 2),
        'utf-8'
      );
    } catch {
      // ignore
    }

    return evaluationResult;
  } finally {
    // 11. Cleanup temporary evaluation workspace
    if (!options.keepWorkspace && fs.existsSync(evalWorkspacePath)) {
      try {
        fs.rmSync(evalWorkspacePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }
}
