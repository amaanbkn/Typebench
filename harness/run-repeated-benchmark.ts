#!/usr/bin/env node

/**
 * TypeBench Repeated Benchmark Execution & Statistical Reliability CLI
 * Usage:
 *   npx tsx harness/run-repeated-benchmark.ts --release dataset/releases/v0.1.0.json --agent mock --trials 3 [--limit 2] [--verbose]
 */

import { runRepeatedBenchmark, formatReliabilityReportSummary } from './statistics.js';
import { listAvailableAgents } from '../agents/agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let releaseArg = 'dataset/releases/v0.1.0.json';
  let agentArg = 'mock';
  let trials = 3;
  let limit: number | undefined;
  let timeoutSec = 300;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--release' || arg === '-r') {
      releaseArg = args[++i];
    } else if (arg === '--agent' || arg === '-a') {
      agentArg = args[++i];
    } else if (arg === '--trials' || arg === '-n') {
      trials = parseInt(args[++i], 10);
    } else if (arg === '--limit' || arg === '-l') {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Repeated Benchmark & Statistical Reliability Runner

Usage:
  npx tsx harness/run-repeated-benchmark.ts [options]

Options:
  -r, --release <path>    Path to release JSON or version tag (default: dataset/releases/v0.1.0.json)
  -a, --agent <name>      Name of coding agent to evaluate (default: mock | available: ${listAvailableAgents().join(', ')})
  -n, --trials <n>        Number of independent repeated trials (default: 3)
  -l, --limit <n>         Limit execution to first N tasks in the release
  --timeout <seconds>     Task timeout in seconds (default: 300)
  -v, --verbose           Show detailed execution step logs
  -h, --help              Show help
`);
      process.exit(0);
    }
  }

  const report = await runRepeatedBenchmark(releaseArg, agentArg, {
    trials,
    limit,
    timeoutSec,
    verbose,
  });

  console.log(formatReliabilityReportSummary(report));
}

main().catch((err) => {
  console.error('Fatal repeated benchmark error:', err);
  process.exit(1);
});
