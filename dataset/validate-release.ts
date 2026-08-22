#!/usr/bin/env node

/**
 * TypeBench Release Checkpoint Integrity Validator CLI
 * Usage:
 *   npx tsx dataset/validate-release.ts [--release dataset/releases/v0.1.0.json] [--verbose]
 */

import { verifyReleaseCheckpoint } from './freeze.js';

async function main() {
  const args = process.argv.slice(2);
  let releaseArg = '0.1.0';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--release' || arg === '-r') {
      releaseArg = args[++i];
    } else if (arg === '--version' || arg === '-v') {
      releaseArg = args[++i];
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Release Checkpoint Validator

Usage:
  npx tsx dataset/validate-release.ts [options]

Options:
  -r, --release <path>    Path to release JSON or version tag (default: 0.1.0)
  -v, --version <semver>  Release version tag
  --verbose               Show detailed task validation
  -h, --help              Show help
`);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      releaseArg = arg;
    }
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench] Validating Release Integrity`);
  console.log(`========================================\n`);

  const result = verifyReleaseCheckpoint(releaseArg, { verbose });

  if (result.valid) {
    console.log(`----------------------------------------`);
    console.log(`Release Verification: 🛡️  [PASSED / IMMUTABLE]`);
    console.log(`----------------------------------------`);
    console.log(`Version             : v${result.version}`);
    console.log(`Dataset Fingerprint : ${result.expectedFingerprint}`);
    console.log(`Verified Tasks      : ${result.verifiedTasks}/${result.totalTasks} (100% matched)`);
    console.log(`Tamper Detection    : Zero modifications detected.`);
    console.log(`========================================\n`);
  } else {
    console.error(`----------------------------------------`);
    console.error(`Release Verification: ❌ [FAILED / TAMPERED]`);
    console.error(`----------------------------------------`);
    console.error(`Version             : v${result.version}`);
    console.error(`Expected Fingerprint: ${result.expectedFingerprint}`);
    console.error(`Computed Fingerprint: ${result.computedFingerprint}`);
    console.error(`Verified Tasks      : ${result.verifiedTasks}/${result.totalTasks}`);

    if (result.mismatchedTasks.length > 0) {
      console.error(`\nMismatched Files:`);
      result.mismatchedTasks.forEach((m) => {
        console.error(`  - Task [${m.taskId}] file "${m.field}" was modified!`);
        console.error(`    Expected: ${m.expected}`);
        console.error(`    Actual  : ${m.actual}`);
      });
    }

    if (result.errors.length > 0) {
      console.error(`\nErrors:`);
      result.errors.forEach((e) => console.error(`  - ${e}`));
    }

    console.error(`========================================\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal release validation error:', err);
  process.exit(1);
});
