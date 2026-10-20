#!/usr/bin/env node

/**
 * TypeBench Benchmark Runner CLI
 * Usage:
 *   npx tsx harness/run-benchmark.ts --release dataset/releases/v0.2.0.json --agent mock [--limit 3] [--verbose]
 */

import { runBenchmarkOnRelease, formatBenchmarkReportSummary } from './benchmark-runner.js';
import { listAvailableAgents } from '../agents/agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let releaseArg = 'dataset/releases/v0.2.0.json';
  let agentArg = 'mock';
  let limit: number | undefined;
  let timeoutSec = 300;
  let verbose = false;
  let skipIntegrityCheck = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--release' || arg === '-r') {
      releaseArg = args[++i];
    } else if (arg === '--agent' || arg === '-a') {
      agentArg = args[++i];
    } else if (arg === '--limit' || arg === '-l') {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--skip-integrity-check') {
      skipIntegrityCheck = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Benchmark Execution Runner

Usage:
  npx tsx harness/run-benchmark.ts [options]

Options:
  -r, --release <path>      Path to release JSON or version tag (default: dataset/releases/v0.2.0.json)
  -a, --agent <name>        Name of coding agent to evaluate (default: mock | available: ${listAvailableAgents().join(', ')})
  -l, --limit <n>           Limit execution to first N tasks in the release
  --timeout <seconds>       Task timeout in seconds (default: 300)
  --skip-integrity-check    Skip SHA-256 pre-execution tamper check
  -v, --verbose             Show detailed agent step and evaluation logs
  -h, --help                Show help
`);
      process.exit(0);
    }
  }

  const report = await runBenchmarkOnRelease(releaseArg, agentArg, {
    limit,
    timeoutSec,
    verbose,
    skipIntegrityCheck,
  });

  console.log(formatBenchmarkReportSummary(report));
}

main().catch((err) => {
  console.error('Fatal benchmark execution error:', err);
  process.exit(1);
});
