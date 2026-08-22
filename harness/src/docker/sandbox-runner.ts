/**
 * TypeBench Docker Sandbox Runner
 * Executes benchmark tasks within isolated, reproducible Docker containers,
 * verifying base commit integrity and isolating runtime dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type SandboxStatus =
  | 'passed'
  | 'failed'
  | 'timeout'
  | 'dependency_install_failure'
  | 'infrastructure_failure'
  | 'invalid_task';

export interface SandboxRuntimeInfo {
  nodeVersion?: string;
  packageManager?: string;
  packageManagerVersion?: string;
  dockerImage?: string;
}

export interface SandboxResult {
  taskId: string;
  status: SandboxStatus;
  exitCode: number;
  durationMs: number;
  runtime: SandboxRuntimeInfo;
  baseCommit: string;
  verifiedCommitSha?: string;
  testExecution: {
    command: string;
    passed: boolean;
    stdoutSnippet: string;
    stderrSnippet: string;
  };
  error?: string;
  timestamp: string;
}

export interface SandboxTaskInput {
  taskId: string;
  repository: string;
  repositoryUrl: string;
  baseCommit: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  testCommand: string;
  taskStatus?: string;
}

export interface SandboxRunnerOptions {
  dockerImage?: string;
  timeoutSec?: number;
  dockerfilePath?: string;
  verbose?: boolean;
  autoBuild?: boolean;
}

/**
 * Checks whether Docker is available and reachable on the host.
 */
export async function checkDockerAvailability(): Promise<{ available: boolean; error?: string }> {
  try {
    const env = {
      ...process.env,
      PATH: `/home/shaktimaan/.local/bin:${process.env.PATH}`,
    };
    await execAsync('docker --version', { env });
    await execAsync('docker info', { env, timeout: 5000 });
    return { available: true };
  } catch (err: any) {
    return {
      available: false,
      error: `Docker is not available or daemon is not running: ${err.message || String(err)}`,
    };
  }
}

/**
 * Builds or verifies the Docker sandbox image.
 */
export async function ensureDockerImage(
  imageName = 'typebench-sandbox:latest',
  dockerfilePath = path.resolve(process.cwd(), 'harness/Dockerfile'),
  verbose = false
): Promise<{ success: boolean; error?: string }> {
  const env = {
    ...process.env,
    PATH: `/home/shaktimaan/.local/bin:${process.env.PATH}`,
  };

  try {
    // Check if image already exists
    const { stdout } = await execAsync(`docker images -q ${imageName}`, { env });
    if (stdout.trim().length > 0) {
      if (verbose) console.log(`[DockerSandbox] Image "${imageName}" found.`);
      return { success: true };
    }

    if (verbose) {
      console.log(`[DockerSandbox] Building Docker image "${imageName}" from ${dockerfilePath}...`);
    }

    const contextDir = path.dirname(dockerfilePath);
    await execAsync(`docker build -t ${imageName} -f ${dockerfilePath} ${contextDir}`, {
      env,
      timeout: 180000,
    });

    if (verbose) console.log(`[DockerSandbox] Successfully built image "${imageName}".`);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to build Docker sandbox image: ${err.stderr || err.message || String(err)}`,
    };
  }
}

/**
 * Loads a task definition from a task directory or task.json path.
 */
export function loadTaskDefinition(taskPath: string): SandboxTaskInput {
  let resolvedPath = path.resolve(process.cwd(), taskPath);
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, 'task.json');
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Task definition file not found at: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Executes a benchmark task inside the Docker sandbox.
 */
export async function runTaskInSandbox(
  taskInput: SandboxTaskInput | string,
  options: SandboxRunnerOptions = {}
): Promise<SandboxResult> {
  const startTime = Date.now();
  const timeoutSec = options.timeoutSec ?? 300;
  const timeoutMs = timeoutSec * 1000;
  const imageName = options.dockerImage ?? 'typebench-sandbox:latest';
  const verbose = options.verbose ?? false;

  let task: SandboxTaskInput;
  try {
    task = typeof taskInput === 'string' ? loadTaskDefinition(taskInput) : taskInput;
  } catch (err: any) {
    return {
      taskId: typeof taskInput === 'string' ? path.basename(taskInput) : 'unknown',
      status: 'invalid_task',
      exitCode: 1,
      durationMs: Date.now() - startTime,
      runtime: { dockerImage: imageName },
      baseCommit: 'unknown',
      testExecution: {
        command: 'none',
        passed: false,
        stdoutSnippet: '',
        stderrSnippet: err.message || String(err),
      },
      error: `Invalid task definition: ${err.message || String(err)}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Validate task schema requirements
  if (!task.taskId || !task.repositoryUrl || !task.baseCommit || !task.testCommand) {
    return {
      taskId: task.taskId || 'unknown',
      status: 'invalid_task',
      exitCode: 1,
      durationMs: Date.now() - startTime,
      runtime: { dockerImage: imageName },
      baseCommit: task.baseCommit || 'none',
      testExecution: {
        command: task.testCommand || 'none',
        passed: false,
        stdoutSnippet: '',
        stderrSnippet: 'Task is missing mandatory fields (taskId, repositoryUrl, baseCommit, or testCommand).',
      },
      error: 'Task definition is missing required fields.',
      timestamp: new Date().toISOString(),
    };
  }

  // Check Docker availability on host
  const dockerCheck = await checkDockerAvailability();
  if (!dockerCheck.available) {
    return {
      taskId: task.taskId,
      status: 'infrastructure_failure',
      exitCode: -1,
      durationMs: Date.now() - startTime,
      runtime: {
        dockerImage: imageName,
      },
      baseCommit: task.baseCommit,
      testExecution: {
        command: task.testCommand,
        passed: false,
        stdoutSnippet: '',
        stderrSnippet: dockerCheck.error || 'Docker is unavailable.',
      },
      error: `Docker infrastructure unavailable: ${dockerCheck.error}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Ensure Docker image exists
  if (options.autoBuild !== false) {
    const imageResult = await ensureDockerImage(
      imageName,
      options.dockerfilePath,
      verbose
    );
    if (!imageResult.success) {
      return {
        taskId: task.taskId,
        status: 'infrastructure_failure',
        exitCode: -1,
        durationMs: Date.now() - startTime,
        runtime: { dockerImage: imageName },
        baseCommit: task.baseCommit,
        testExecution: {
          command: task.testCommand,
          passed: false,
          stdoutSnippet: '',
          stderrSnippet: imageResult.error || 'Docker image build failure.',
        },
        error: imageResult.error,
        timestamp: new Date().toISOString(),
      };
    }
  }

  const containerName = `typebench-${task.taskId}-${Date.now().toString(36)}`;
  const env = {
    ...process.env,
    PATH: `/home/shaktimaan/.local/bin:${process.env.PATH}`,
  };

  // Construct deterministic execution script to run inside container
  // Exit code conventions:
  // 101: Git checkout / SHA mismatch error
  // 102: Dependency installation failure
  // 103: Runtime inspection error
  const escapeShell = (str: string) => str.replace(/'/g, "'\\''");

  const runScript = `
set -e
echo "=== [TypeBench Sandbox] Step 1: Runtime Inspection ==="
NODE_VER=$(node -v 2>/dev/null || echo "unknown")
echo "NODE_VERSION: $NODE_VER"

echo "=== [TypeBench Sandbox] Step 2: Repository Preparation ==="
mkdir -p /workspace/repo
git clone '${escapeShell(task.repositoryUrl)}' /workspace/repo
cd /workspace/repo

echo "=== [TypeBench Sandbox] Step 3: Checkout Base Commit ==="
git checkout '${escapeShell(task.baseCommit)}'
CHECKED_OUT_SHA=$(git rev-parse HEAD)
echo "CHECKED_OUT_SHA: $CHECKED_OUT_SHA"

if [ "$CHECKED_OUT_SHA" != "${escapeShell(task.baseCommit)}" ]; then
  echo "ERROR: Checked out SHA ($CHECKED_OUT_SHA) does not match expected baseCommit (${escapeShell(task.baseCommit)})" >&2
  exit 101
fi

echo "=== [TypeBench Sandbox] Step 4: Dependency Setup ==="
export PATH="/workspace/repo/node_modules/.bin:$PATH"
export CI=true

# Detect package manager
PM="npm"
if [ -f "pnpm-lock.yaml" ] || [ -f "pnpm-workspace.yaml" ]; then
  PM="pnpm"
elif [ -f "yarn.lock" ]; then
  PM="yarn"
fi
PM_VER=$($PM -v 2>/dev/null || echo "unknown")
echo "PACKAGE_MANAGER: $PM"
echo "PACKAGE_MANAGER_VERSION: $PM_VER"

if [ "$PM" = "pnpm" ]; then
  pnpm install --no-frozen-lockfile --ignore-scripts || exit 102
elif [ "$PM" = "yarn" ]; then
  yarn install --ignore-scripts || exit 102
else
  npm install --no-audit --no-fund || exit 102
fi

echo "=== [TypeBench Sandbox] Step 5: Test Execution ==="
${task.testCommand}
`;

  try {
    if (verbose) {
      console.log(`[DockerSandbox] Starting container ${containerName}...`);
    }

    const command = `docker run --name ${containerName} --rm -i ${imageName} /bin/bash -c '${escapeShell(runScript)}'`;

    const { stdout, stderr } = await execAsync(command, {
      env,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    const durationMs = Date.now() - startTime;
    const stdoutStr = stdout || '';
    const stderrStr = stderr || '';

    // Extract runtime info
    const nodeMatch = stdoutStr.match(/NODE_VERSION:\s*(.+)/);
    const pmMatch = stdoutStr.match(/PACKAGE_MANAGER:\s*(.+)/);
    const pmVerMatch = stdoutStr.match(/PACKAGE_MANAGER_VERSION:\s*(.+)/);
    const shaMatch = stdoutStr.match(/CHECKED_OUT_SHA:\s*(.+)/);

    return {
      taskId: task.taskId,
      status: 'passed',
      exitCode: 0,
      durationMs,
      runtime: {
        nodeVersion: nodeMatch ? nodeMatch[1].trim() : undefined,
        packageManager: pmMatch ? pmMatch[1].trim() : undefined,
        packageManagerVersion: pmVerMatch ? pmVerMatch[1].trim() : undefined,
        dockerImage: imageName,
      },
      baseCommit: task.baseCommit,
      verifiedCommitSha: shaMatch ? shaMatch[1].trim() : task.baseCommit,
      testExecution: {
        command: task.testCommand,
        passed: true,
        stdoutSnippet: stdoutStr.slice(-2000).trim(),
        stderrSnippet: stderrStr.slice(-1000).trim(),
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const stdoutStr = (err.stdout || '').toString();
    const stderrStr = (err.stderr || err.message || '').toString();
    const isTimeout = err.killed && err.signal === 'SIGTERM';
    const exitCode = typeof err.code === 'number' ? err.code : 1;

    // Extract runtime info if present
    const nodeMatch = stdoutStr.match(/NODE_VERSION:\s*(.+)/);
    const pmMatch = stdoutStr.match(/PACKAGE_MANAGER:\s*(.+)/);
    const pmVerMatch = stdoutStr.match(/PACKAGE_MANAGER_VERSION:\s*(.+)/);
    const shaMatch = stdoutStr.match(/CHECKED_OUT_SHA:\s*(.+)/);

    let status: SandboxStatus = 'failed';
    let errorMessage: string | undefined;

    if (isTimeout) {
      status = 'timeout';
      errorMessage = `Sandbox execution timed out after ${timeoutSec} seconds.`;
    } else if (exitCode === 101) {
      status = 'infrastructure_failure';
      errorMessage = `Checked out commit does not match task baseCommit.`;
    } else if (exitCode === 102) {
      status = 'dependency_install_failure';
      errorMessage = `Dependency installation failed inside container.`;
    }

    return {
      taskId: task.taskId,
      status,
      exitCode,
      durationMs,
      runtime: {
        nodeVersion: nodeMatch ? nodeMatch[1].trim() : undefined,
        packageManager: pmMatch ? pmMatch[1].trim() : undefined,
        packageManagerVersion: pmVerMatch ? pmVerMatch[1].trim() : undefined,
        dockerImage: imageName,
      },
      baseCommit: task.baseCommit,
      verifiedCommitSha: shaMatch ? shaMatch[1].trim() : undefined,
      testExecution: {
        command: task.testCommand,
        passed: false,
        stdoutSnippet: stdoutStr.slice(-2000).trim(),
        stderrSnippet: stderrStr.slice(-1000).trim(),
      },
      error: errorMessage,
      timestamp: new Date().toISOString(),
    };
  } finally {
    // Guaranteed teardown: Ensure container is destroyed
    try {
      await execAsync(`docker rm -f ${containerName} 2>/dev/null || true`, { env });
    } catch {
      // Ignore cleanup error if already removed
    }
  }
}
