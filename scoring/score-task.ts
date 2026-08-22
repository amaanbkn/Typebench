#!/usr/bin/env node

/**
 * TypeBench Scoring CLI Entrypoint
 * Usage:
 *   npx tsx scoring/score-task.ts --evaluation results/evaluations/<run-id>/evaluation.json [--verbose]
 */

import { scoreRun } from './scorer.js';

async function main() {
  const args = process.argv.slice(2);
  let evalPath: string | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--evaluation' || arg === '-e') {
      evalPath = args[++i];
    } else if (arg === '--run' || arg === '-r') {
      evalPath = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Task Scoring Runner

Usage:
  npx tsx scoring/score-task.ts --evaluation <path-to-eval-or-run-id> [options]

Options:
  -e, --evaluation <path>  Path to evaluation.json or results/evaluations/<run-id>
  -r, --run <run-id>       Run ID in results/evaluations/
  -v, --verbose            Show detailed scoring calculations
  -h, --help               Show help
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !evalPath) {
      evalPath = arg;
    }
  }

  if (!evalPath) {
    console.error('Error: Please specify an evaluation using --evaluation <path-or-run-id>');
    console.log('Example: npx tsx scoring/score-task.ts --evaluation results/evaluations/trpc-c7360d4_mock_...');
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench] Computing Score`);
  console.log(`========================================\n`);

  const result = scoreRun(evalPath, { verbose });

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
  console.log(`Score Summary: ${statusBadge}`);
  console.log(`----------------------------------------`);
  console.log(`Task ID     : ${result.taskId}`);
  console.log(`Agent       : ${result.agentName}`);
  console.log(`Run ID      : ${result.runId}`);
  console.log(`Status      : ${result.status}`);
  console.log(`Available   : ${result.isAvailable ? 'Yes' : 'No (Infrastructure issue)'}`);

  console.log(`\n[Score Components]:`);
  console.log(
    `  Benchmark tests  : ${result.components.benchmarkTests.score}/${result.components.benchmarkTests.maxScore} (${result.components.benchmarkTests.status})`
  );
  console.log(
    `  Regression tests : ${result.components.regressionTests.score}/${result.components.regressionTests.maxScore} (${result.components.regressionTests.status})`
  );
  console.log(
    `  Typecheck        : ${result.components.typecheck.score}/${result.components.typecheck.maxScore} (${result.components.typecheck.status})`
  );

  const scoreDisplay = result.score !== null ? `${result.score}/${result.maxScore}` : 'N/A (Unavailable)';
  console.log(`\nFinal Score : ${scoreDisplay}`);
  console.log(`Score Saved : results/scores/${result.runId}/score.json`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error('Fatal scoring error:', err);
  process.exit(1);
});
