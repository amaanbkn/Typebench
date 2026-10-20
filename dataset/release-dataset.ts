#!/usr/bin/env node

/**
 * TypeBench Dataset Release & Freeze CLI
 * Usage:
 *   npx tsx dataset/release-dataset.ts --version 0.2.0 [--verbose]
 */

import { freezeDataset } from './freeze.js';

async function main() {
  const args = process.argv.slice(2);
  let version = '0.2.0';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--version' || arg === '-v') {
      version = args[++i];
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Dataset Release & Freeze CLI

Usage:
  npx tsx dataset/release-dataset.ts [options]

Options:
  -v, --version <semver>  Release version tag (default: 0.2.0)
  --verbose               Show detailed task checksums
  -h, --help              Show help
`);
      process.exit(0);
    }
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench] Freezing Dataset Release v${version}`);
  console.log(`========================================\n`);

  const checkpoint = freezeDataset(version, { verbose });

  console.log(`----------------------------------------`);
  console.log(`Release Checkpoint: 🧊 [FROZEN]`);
  console.log(`----------------------------------------`);
  console.log(`Version             : v${checkpoint.version}`);
  console.log(`Release Date        : ${checkpoint.releaseDate}`);
  console.log(`Dataset Fingerprint : ${checkpoint.datasetFingerprint}`);
  console.log(`Total Tasks         : ${checkpoint.totalTasks}`);
  console.log(
    `Repositories        : ${checkpoint.repositories.map((r) => `${r.name} (${r.taskCount} tasks)`).join(', ')}`
  );

  console.log(`\nTask Fingerprints:`);
  checkpoint.tasks.forEach((t, i) => {
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}. [${t.taskId.padEnd(14, ' ')}] SHA: ${t.checksums.composite.slice(0, 18)}... | ${t.title}`
    );
  });

  console.log(`\nSaved Artifact: dataset/releases/v${version}.json`);
  console.log(`Updated Manifest: dataset/manifest.json`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error('Fatal dataset release error:', err);
  process.exit(1);
});
