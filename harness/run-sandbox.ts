#!/usr/bin/env node

/**
 * TypeBench Sandbox Task Runner CLI
 * Usage:
 *   npx tsx harness/run-sandbox.ts --task tasks/trpc-c7360d4 [--verbose] [--timeout <seconds>]
 */

import { runTaskInSandbox } from './src/docker/sandbox-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let taskPath: string | undefined;
  let timeoutSec = 300;
  let verbose = false;
  let dockerImage = 'typebench-sandbox:latest';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--task' || arg === '-t') {
      taskPath = args[++i];
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--image' || arg === '-i') {
      dockerImage = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Docker Sandbox Task Runner

Usage:
  npx tsx harness/run-sandbox.ts --task <path-to-task-dir-or-json> [options]

Options:
  -t, --task <path>      Path to task directory (e.g. tasks/trpc-c7360d4) or task.json
  --timeout <seconds>    Execution timeout in seconds (default: 300)
  -i, --image <name>     Docker sandbox image tag (default: typebench-sandbox:latest)
  -v, --verbose          Show detailed execution logs and command outputs
  -h, --help             Show help
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !taskPath) {
      taskPath = arg;
    }
  }

  if (!taskPath) {
    console.error('Error: Please specify a task using --task <path>');
    console.log('Example: npx tsx harness/run-sandbox.ts --task tasks/trpc-c7360d4');
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench Sandbox] Starting Task Run`);
  console.log(`========================================\n`);
  console.log(`Task Path : ${taskPath}`);
  console.log(`Timeout   : ${timeoutSec}s`);
  console.log(`Image     : ${dockerImage}\n`);

  const result = await runTaskInSandbox(taskPath, {
    dockerImage,
    timeoutSec,
    verbose,
  });

  const statusBadge =
    result.status === 'passed'
      ? '✅ [PASSED]'
      : result.status === 'failed'
      ? '❌ [TEST FAILED]'
      : result.status === 'timeout'
      ? '⏳ [TIMEOUT]'
      : result.status === 'dependency_install_failure'
      ? '📦 [DEPENDENCY INSTALL FAILURE]'
      : result.status === 'infrastructure_failure'
      ? '⚠️  [INFRASTRUCTURE FAILURE]'
      : '🚫 [INVALID TASK]';

  console.log(`\n----------------------------------------`);
  console.log(`Task Execution Result: ${statusBadge}`);
  console.log(`----------------------------------------`);
  console.log(`Task ID         : ${result.taskId}`);
  console.log(`Status          : ${result.status}`);
  console.log(`Exit Code       : ${result.exitCode}`);
  console.log(`Duration        : ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`Base Commit     : ${result.baseCommit}`);
  if (result.verifiedCommitSha) {
    console.log(`Verified Commit : ${result.verifiedCommitSha}`);
  }
  if (result.runtime.nodeVersion) {
    console.log(`Node Version    : ${result.runtime.nodeVersion}`);
  }
  if (result.runtime.packageManager) {
    console.log(`Package Manager : ${result.runtime.packageManager} (v${result.runtime.packageManagerVersion || 'unknown'})`);
  }
  console.log(`Test Command    : ${result.testExecution.command}`);

  if (result.error) {
    console.log(`\n[Error Details]:\n${result.error}`);
  }

  if (verbose || result.status !== 'passed') {
    if (result.testExecution.stderrSnippet) {
      console.log(`\n[Stderr Snippet]:\n${result.testExecution.stderrSnippet}`);
    }
    if (result.testExecution.stdoutSnippet) {
      console.log(`\n[Stdout Snippet]:\n${result.testExecution.stdoutSnippet}`);
    }
  }

  console.log(`\n========================================\n`);

  // Return non-zero exit code on failures
  if (result.status !== 'passed') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal sandbox execution error:', err);
  process.exit(1);
});
