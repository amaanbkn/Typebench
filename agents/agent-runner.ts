/**
 * TypeBench Agent Runner & Abstraction Engine
 * Coordinates agent context setup, isolated workspace checkout, agent execution,
 * Git patch extraction, and run results persistence.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import { CodingAgent, AgentContext, AgentResult, AgentStatus } from './base-agent.js';
import mockAgent from './mock/index.js';
import nemotronAgent from './nemotron/index.js';
import tsSolverAgent from './ts-solver/index.js';

export interface TaskDefinitionInput {
  taskId: string;
  repository: string;
  repositoryUrl: string;
  baseCommit: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  testCommand?: string;
  prompt?: string;
}

export interface AgentRunnerOptions {
  timeoutSec?: number;
  verbose?: boolean;
  keepWorkspace?: boolean;
  outputRunsDir?: string;
}

/**
 * Registry of available coding agents in Typebench.
 */
const AGENT_REGISTRY: Record<string, CodingAgent> = {
  mock: mockAgent,
  nemotron: nemotronAgent,
  'ts-solver': tsSolverAgent,
};

export function registerAgent(agent: CodingAgent): void {
  AGENT_REGISTRY[agent.name.toLowerCase()] = agent;
}

export function getAgent(name: string): CodingAgent | undefined {
  return AGENT_REGISTRY[name.toLowerCase()];
}

export function listAvailableAgents(): string[] {
  return Object.keys(AGENT_REGISTRY);
}

/**
 * Loads a task directory and extracts only agent-facing files (task.json and prompt.md).
 * Ground truth metadata (metadata.json) is strictly not passed to the agent context.
 */
export function loadAgentTask(taskDirOrJson: string): {
  taskConfig: TaskDefinitionInput;
  prompt: string;
} {
  let taskDir = path.resolve(process.cwd(), taskDirOrJson);
  let taskJsonPath = taskDir;

  if (fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()) {
    taskJsonPath = path.join(taskDir, 'task.json');
  } else {
    taskDir = path.dirname(taskDir);
  }

  if (!fs.existsSync(taskJsonPath)) {
    throw new Error(`task.json not found at: ${taskJsonPath}`);
  }

  const promptPath = path.join(taskDir, 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`prompt.md not found at: ${promptPath}`);
  }

  const taskConfig: TaskDefinitionInput = JSON.parse(fs.readFileSync(taskJsonPath, 'utf-8'));
  const prompt = fs.readFileSync(promptPath, 'utf-8');

  return { taskConfig, prompt };
}

/**
 * Captures changed files and full unified Git diff from an isolated workspace.
 */
export async function captureWorkspacePatch(workspacePath: string): Promise<{
  changedFiles: string[];
  patch: string;
}> {
  const git: SimpleGit = simpleGit(workspacePath);

  try {
    // Stage untracked files into intent-to-add so git diff captures newly created files
    await git.raw(['add', '-N', '.']);

    // Capture modified / added files
    const status = await git.status();
    const changedFiles = [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.not_added,
    ];

    // Capture unified diff
    const patch = await git.diff();

    return {
      changedFiles: Array.from(new Set(changedFiles)),
      patch: patch || '(no changes made by agent)',
    };
  } catch (err: any) {
    return {
      changedFiles: [],
      patch: `Error capturing patch: ${err.message || String(err)}`,
    };
  }
}

/**
 * Executes a chosen coding agent against a TypeBench task in an isolated workspace.
 */
export async function executeAgentOnTask(
  taskPath: string,
  agentName: string,
  options: AgentRunnerOptions = {}
): Promise<AgentResult> {
  const startTime = Date.now();
  const timeoutSec = options.timeoutSec ?? 300;
  const timeoutMs = timeoutSec * 1000;
  const runsBaseDir = options.outputRunsDir ?? path.resolve(process.cwd(), 'results/runs');
  const tempBaseDir = path.join(os.tmpdir(), 'typebench-agent-workspaces');

  // 1. Resolve agent
  const agent = getAgent(agentName);
  if (!agent) {
    const runId = `run_${Date.now().toString(36)}`;
    return {
      runId,
      taskId: 'unknown',
      agentName,
      status: 'infrastructure_failure',
      exitCode: 1,
      durationMs: Date.now() - startTime,
      changedFiles: [],
      patch: '',
      stdout: '',
      stderr: `Agent "${agentName}" is not registered. Available agents: ${listAvailableAgents().join(', ')}`,
      error: `Agent "${agentName}" not found.`,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Load task
  let taskConfig: TaskDefinitionInput;
  let prompt: string;
  try {
    const loaded = loadAgentTask(taskPath);
    taskConfig = loaded.taskConfig;
    prompt = loaded.prompt;
  } catch (err: any) {
    const runId = `run_${Date.now().toString(36)}`;
    return {
      runId,
      taskId: 'unknown',
      agentName: agent.name,
      status: 'infrastructure_failure',
      exitCode: 1,
      durationMs: Date.now() - startTime,
      changedFiles: [],
      patch: '',
      stdout: '',
      stderr: err.message || String(err),
      error: `Failed to load task: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }

  const runId = `${taskConfig.taskId}_${agent.name}_${Date.now().toString(36)}`;
  const workspacePath = path.join(tempBaseDir, runId);
  const runOutputDir = path.join(runsBaseDir, runId);

  fs.mkdirSync(tempBaseDir, { recursive: true });

  try {
    if (options.verbose) {
      console.log(`[AgentRunner] Initializing agent "${agent.name}"...`);
    }
    if (agent.initialize) {
      await agent.initialize();
    }

    // 3. Clone repository and checkout baseCommit in isolated workspace
    if (options.verbose) {
      console.log(`[AgentRunner] Cloning repository ${taskConfig.repositoryUrl} to ${workspacePath}...`);
    }

    const hostGit = simpleGit();
    await hostGit.clone(taskConfig.repositoryUrl, workspacePath);

    const workspaceGit = simpleGit(workspacePath);
    await workspaceGit.checkout(taskConfig.baseCommit);

    const headSha = (await workspaceGit.raw(['rev-parse', 'HEAD'])).trim();
    if (!headSha.startsWith(taskConfig.baseCommit.slice(0, 7))) {
      throw new Error(`Checked out SHA (${headSha}) does not match expected baseCommit (${taskConfig.baseCommit})`);
    }

    if (options.verbose) {
      console.log(`[AgentRunner] Verified workspace at baseCommit: ${headSha.slice(0, 7)}`);
    }

    // 4. Construct Agent Context (Strictly agent-facing)
    const context: AgentContext = {
      taskId: taskConfig.taskId,
      taskPrompt: prompt,
      repository: taskConfig.repository,
      repositoryUrl: taskConfig.repositoryUrl,
      baseCommit: taskConfig.baseCommit,
      workspacePath,
      timeoutMs,
      environment: {
        nodeVersion: process.version,
        packageManager: taskConfig.packageManager || 'npm',
      },
    };

    // 5. Run agent with timeout race
    if (options.verbose) {
      console.log(`[AgentRunner] Launching agent "${agent.name}"...`);
    }

    const agentPromise = agent.run(context);
    const timeoutPromise = new Promise<{
      agentName: string;
      status: AgentStatus;
      exitCode: number;
      durationMs: number;
      stdout: string;
      stderr: string;
      tokensUsed?: number;
      error?: string;
    }>((resolve) => {
      setTimeout(() => {
        resolve({
          agentName: agent.name,
          status: 'timeout',
          exitCode: 124,
          durationMs: timeoutMs,
          stdout: '',
          stderr: `Agent execution timed out after ${timeoutSec} seconds.`,
          error: 'Execution timeout exceeded.',
        });
      }, timeoutMs);
    });

    const agentOutput = await Promise.race([agentPromise, timeoutPromise]);

    // 6. Capture Git modifications and unified patch
    const { changedFiles, patch } = await captureWorkspacePatch(workspacePath);

    const durationMs = Date.now() - startTime;

    const finalResult: AgentResult = {
      runId,
      taskId: taskConfig.taskId,
      agentName: agent.name,
      status: agentOutput.status,
      exitCode: agentOutput.exitCode,
      durationMs,
      changedFiles,
      patch,
      stdout: agentOutput.stdout,
      stderr: agentOutput.stderr,
      tokensUsed: agentOutput.tokensUsed,
      error: agentOutput.error,
      timestamp: new Date().toISOString(),
    };

    // 7. Save run result artifacts under results/runs/<run-id>/
    fs.mkdirSync(runOutputDir, { recursive: true });

    fs.writeFileSync(
      path.join(runOutputDir, 'result.json'),
      JSON.stringify(finalResult, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(runOutputDir, 'patch.diff'),
      patch,
      'utf-8'
    );

    if (options.verbose) {
      console.log(`[AgentRunner] Run artifacts saved to: ${runOutputDir}`);
    }

    return finalResult;
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const finalResult: AgentResult = {
      runId,
      taskId: taskConfig ? taskConfig.taskId : 'unknown',
      agentName: agent.name,
      status: 'infrastructure_failure',
      exitCode: 1,
      durationMs,
      changedFiles: [],
      patch: '',
      stdout: '',
      stderr: err.message || String(err),
      error: `Agent runner error: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };

    try {
      fs.mkdirSync(runOutputDir, { recursive: true });
      fs.writeFileSync(
        path.join(runOutputDir, 'result.json'),
        JSON.stringify(finalResult, null, 2),
        'utf-8'
      );
    } catch {
      // ignore
    }

    return finalResult;
  } finally {
    // 8. Cleanup temporary workspace
    if (!options.keepWorkspace && fs.existsSync(workspacePath)) {
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }

    if (agent && agent.cleanup) {
      try {
        await agent.cleanup();
      } catch {
        // ignore cleanup error
      }
    }
  }
}
