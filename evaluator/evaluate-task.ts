#!/usr/bin/env node

/**
 * TypeBench Evaluation CLI Entrypoint
 * Usage:
 *   npx tsx evaluator/evaluate-task.ts --run results/runs/<run-id> [--verbose]
 */

import { evaluateRun } from './evaluator.js';

async function main() {
  const args = process.argv.slice(2);
  let runPath: string | undefined;
  let timeoutSec = 300;
  let verbose = false;
  let keepWorkspace = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--run' || arg === '-r') {
      runPath = args[++i];
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--keep-workspace') {
      keepWorkspace = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Task Evaluation Runner

Usage:
  npx tsx evaluator/evaluate-task.ts --run <path-to-run-or-run-id> [options]

Options:
  -r, --run <path>      Path to run directory (e.g. results/runs/trpc-c7360d4_mock_...) or run ID
  --timeout <seconds>   Execution timeout in seconds (default: 300)
  --keep-workspace      Preserve the temporary workspace directory after evaluation
  -v, --verbose         Show detailed evaluation and test logs
  -h, --help            Show help
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !runPath) {
      runPath = arg;
    }
  }

  if (!runPath) {
    console.error('Error: Please specify a run using --run <path-or-run-id>');
    console.log('Example: npx tsx evaluator/evaluate-task.ts --run results/runs/trpc-c7360d4_mock_...');
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench Evaluator] Starting Task Evaluation`);
  console.log(`========================================\n`);
  console.log(`Run Path  : ${runPath}`);
  console.log(`Timeout   : ${timeoutSec}s\n`);

  const result = await evaluateRun(runPath, {
    timeoutSec,
    verbose,
    keepWorkspace,
  });

  const statusBadge =
    result.status === 'solved'
      ? '🌟 [SOLVED]'
      : result.status === 'failed'
      ? '❌ [FAILED]'
      : result.status === 'no_changes'
      ? '⚠️  [NO CHANGES]'
      : result.status === 'timeout'
      ? '⏳ [TIMEOUT]'
      : result.status === 'infrastructure_failure'
      ? '⚠️  [INFRASTRUCTURE FAILURE]'
      : '🚫 [INVALID TASK]';

  console.log(`----------------------------------------`);
  console.log(`Evaluation Result: ${statusBadge}`);
  console.log(`----------------------------------------`);
  console.log(`Run ID          : ${result.runId}`);
  console.log(`Task ID         : ${result.taskId}`);
  console.log(`Agent           : ${result.agentName}`);
  console.log(`Overall Status  : ${result.status}`);
  console.log(`Duration        : ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`Changed Files   : ${result.changedFiles.length}`);
  if (result.changedFiles.length > 0) {
    result.changedFiles.forEach((f) => console.log(`  - ${f}`));
  }

  console.log(`\n[Benchmark Tests]:`);
  console.log(`  Command : ${result.benchmarkTests.command}`);
  console.log(`  Status  : ${result.benchmarkTests.status} (exit ${result.benchmarkTests.exitCode})`);
  console.log(`  Passed  : ${result.benchmarkTests.passed ? 'Yes' : 'No'}`);

  if (result.typecheck) {
    console.log(`\n[Static Typecheck]:`);
    console.log(`  Command : ${result.typecheck.command}`);
    console.log(`  Status  : ${result.typecheck.status} (exit ${result.typecheck.exitCode})`);
    console.log(`  Passed  : ${result.typecheck.passed ? 'Yes' : 'No'}`);
  }

  if (result.error) {
    console.log(`\n[Error Details]:\n${result.error}`);
  }

  if (verbose || !result.benchmarkTests.passed) {
    if (result.benchmarkTests.stderrSnippet) {
      console.log(`\n[Benchmark Stderr Snippet]:\n${result.benchmarkTests.stderrSnippet}`);
    }
    if (result.benchmarkTests.stdoutSnippet) {
      console.log(`\n[Benchmark Stdout Snippet]:\n${result.benchmarkTests.stdoutSnippet}`);
    }
  }

  console.log(`\nEvaluation Saved: results/evaluations/${result.runId}/evaluation.json`);
  console.log(`========================================\n`);

  if (result.status !== 'solved') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal evaluator error:', err);
  process.exit(1);
});
