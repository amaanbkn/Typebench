#!/usr/bin/env node

/**
 * TypeBench Dataset Readiness Validator CLI
 * Usage:
 *   npx tsx dataset/validate-readiness.ts [--update-manifest] [--run-sandbox] [--verbose]
 */

import { checkDatasetReadiness } from './readiness-check.js';

async function main() {
  const args = process.argv.slice(2);
  let updateTaskFiles = false;
  let runSandbox = false;
  let timeoutSec = 180;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--update-manifest' || arg === '-u' || arg === '--update') {
      updateTaskFiles = true;
    } else if (arg === '--run-sandbox' || arg === '--sandbox') {
      runSandbox = true;
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Dataset Readiness Validator

Usage:
  npx tsx dataset/validate-readiness.ts [options]

Options:
  -u, --update-manifest    Update task.json, metadata.json and re-synchronize dataset/manifest.json
  --run-sandbox            Execute task inside Docker container sandbox for reproducibility verification
  --timeout <seconds>      Sandbox timeout per task (default: 180)
  -v, --verbose            Show verbose verification reasons
  -h, --help               Show help
`);
      process.exit(0);
    }
  }

  const summary = await checkDatasetReadiness(undefined, {
    updateTaskFiles,
    runSandbox,
    timeoutSec,
    verbose,
  });

  console.log('\n========================================================================================');
  console.log('TYPEBENCH DATASET READINESS SUMMARY');
  console.log('========================================================================================\n');
  console.log(`Total Tasks Evaluated : ${summary.totalTasks}`);
  console.log(`Ready Tasks (🌟)      : ${summary.readyCount}`);
  console.log(`Needs Review (⚠️ )     : ${summary.needsReviewCount}`);
  console.log(`Rejected Tasks (❌)   : ${summary.rejectedCount}`);
  console.log(`Duration              : ${(summary.durationMs / 1000).toFixed(2)}s\n`);

  if (verbose) {
    console.log('Detailed Task Breakdown:');
    for (const [taskId, result] of Object.entries(summary.tasks)) {
      console.log(`\nTask: ${taskId} (${result.status})`);
      console.log(`  - Schema Valid       : ${result.checks.schemaValid ? 'Yes' : 'No'}`);
      console.log(`  - Base Commit Hash   : ${result.checks.baseCommitResolves ? 'Valid' : 'Invalid'}`);
      console.log(`  - Anti-Contamination : ${result.checks.antiContamination ? 'Passed' : 'Failed'}`);
      console.log(`  - Test Command       : ${result.checks.testCommandConfigured ? 'Configured' : 'Missing'}`);
      console.log(`  - Sandbox Executable : ${result.checks.sandboxExecutable ? 'Yes' : 'No'}`);
      if (result.reasons.length > 0) {
        console.log(`  - Reasons: ${result.reasons.join('; ')}`);
      }
    }
    console.log('');
  }

  console.log('========================================================================================\n');
}

main().catch((err) => {
  console.error('Fatal readiness validation error:', err);
  process.exit(1);
});
