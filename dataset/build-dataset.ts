#!/usr/bin/env node

/**
 * TypeBench Dataset Builder CLI
 * Usage:
 *   npx tsx dataset/build-dataset.ts [--repos trpc,zod,hono] [--depth 25] [--create-tasks] [--verbose]
 */

import { buildDataset, compileManifest } from './builder.js';
import { getSeedRepos } from '../scripts/clone-repo.js';

async function main() {
  const args = process.argv.slice(2);
  let reposArg: string | undefined;
  let depth = 25;
  let limit = 4;
  let createTasks = true;
  let manifestOnly = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repos' || arg === '-r') {
      reposArg = args[++i];
    } else if (arg === '--depth' || arg === '-d') {
      depth = parseInt(args[++i], 10);
    } else if (arg === '--limit' || arg === '-l') {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--manifest-only') {
      manifestOnly = true;
    } else if (arg === '--no-create-tasks') {
      createTasks = false;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Benchmark Dataset Builder

Usage:
  npx tsx dataset/build-dataset.ts [options]

Options:
  -r, --repos <list>    Comma-separated repository names from seed-repos.json (default: trpc,zod,hono)
  -d, --depth <n>       Git history depth per repository (default: 25)
  -l, --limit <n>       Max candidate tasks to extract per repository (default: 4)
  --manifest-only       Recompile dataset/manifest.json from existing tasks/ without fetching new commits
  --no-create-tasks     Scan and validate without creating task directories
  -v, --verbose         Show verbose filtering output
  -h, --help            Show help

Available seed repositories:
${getSeedRepos().map((r) => `  - ${r.name} (${r.category})`).join('\n')}
`);
      process.exit(0);
    }
  }

  if (manifestOnly) {
    console.log('\n[TypeBench] Recompiling dataset manifest from tasks/...');
    const manifest = compileManifest();
    printManifestSummary(manifest);
    process.exit(0);
  }

  const seedRepos = getSeedRepos();
  const repoQueries = reposArg
    ? reposArg.split(',').map((s) => s.trim()).filter(Boolean)
    : ['trpc', 'zod', 'hono'];

  const manifest = await buildDataset(repoQueries, {
    historyDepth: depth,
    maxCandidatesPerRepo: limit,
    createTasks,
    verbose,
  });

  printManifestSummary(manifest);
}

function printManifestSummary(manifest: ReturnType<typeof compileManifest>) {
  console.log('========================================================================================');
  console.log(`TYPEBENCH DATASET MANIFEST SUMMARY (v${manifest.datasetVersion})`);
  console.log('========================================================================================\n');

  console.log(`Total Tasks Registered : ${manifest.statistics.totalTasks}`);
  console.log(`Repositories Included  : ${manifest.repositories.length} (${manifest.repositories.map((r) => r.name).join(', ')})\n`);

  console.log('Breakdown by Status:');
  for (const [status, count] of Object.entries(manifest.statistics.byStatus)) {
    console.log(`  - ${status.padEnd(16, ' ')} : ${count}`);
  }

  console.log('\nBreakdown by Category:');
  for (const [cat, count] of Object.entries(manifest.statistics.byCategory)) {
    console.log(`  - ${cat.padEnd(16, ' ')} : ${count}`);
  }

  console.log('\nBreakdown by Difficulty:');
  for (const [diff, count] of Object.entries(manifest.statistics.byDifficulty)) {
    console.log(`  - ${diff.padEnd(16, ' ')} : ${count}`);
  }

  console.log('\nTask Registry:');
  manifest.tasks.forEach((t, i) => {
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}. [${t.taskId.padEnd(14, ' ')}] (${t.repository.padEnd(6, ' ')}) | ${t.category.padEnd(12, ' ')} | ${t.difficulty.padEnd(6, ' ')} | ${t.title}`
    );
  });

  console.log('\n========================================================================================\n');
}

main().catch((err) => {
  console.error('Fatal dataset build error:', err);
  process.exit(1);
});
