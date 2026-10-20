#!/usr/bin/env node

/**
 * TypeBench Standardized Benchmark Protocol CLI
 * Usage:
 *   npx tsx harness/run-protocol.ts --release dataset/releases/v0.2.0.json --agents mock,nemotron --trials 2 [--limit 2] [--verbose]
 */

import {
  createDefaultProtocolConfig,
  executeBenchmarkProtocol,
  formatProtocolReportSummary,
} from './protocol.js';
import { listAvailableAgents } from '../agents/agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let releaseArg = 'dataset/releases/v0.2.0.json';
  let agentsArg = ['mock'];
  let trials = 3;
  let timeoutSec = 300;
  let limit: number | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--release' || arg === '-r') {
      releaseArg = args[++i];
    } else if (arg === '--agents' || arg === '-a') {
      agentsArg = args[++i].split(',').map((s) => s.trim());
    } else if (arg === '--trials' || arg === '-n') {
      trials = parseInt(args[++i], 10);
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--limit' || arg === '-l') {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Standardized Benchmark Protocol Runner

Usage:
  npx tsx harness/run-protocol.ts [options]

Options:
  -r, --release <path>     Path to release JSON checkpoint (default: dataset/releases/v0.2.0.json)
  -a, --agents <list>      Comma-separated agent names (default: mock | available: ${listAvailableAgents().join(', ')})
  -n, --trials <n>         Trials per task for each agent (default: 3)
  --timeout <seconds>      Uniform task timeout in seconds (default: 300)
  -l, --limit <n>          Limit evaluation to first N tasks in release
  -v, --verbose            Show detailed agent steps and evaluation logs
  -h, --help               Show help
`);
      process.exit(0);
    }
  }

  const config = createDefaultProtocolConfig(releaseArg);
  config.trialsPerTask = trials;
  config.timeoutSecPerTask = timeoutSec;

  const report = await executeBenchmarkProtocol(config, agentsArg, {
    limit,
    verbose,
  });

  console.log(formatProtocolReportSummary(report));
}

main().catch((err) => {
  console.error('Fatal protocol execution error:', err);
  process.exit(1);
});
