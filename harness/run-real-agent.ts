#!/usr/bin/env node

/**
 * TypeBench Real-Agent Benchmark Validation CLI
 * Usage:
 *   npx tsx harness/run-real-agent.ts --agent ts-solver --release dataset/releases/v0.1.0.json --trials 2 [--limit 2] [--verbose]
 */

import {
  validateRealAgentExecution,
  formatAgentValidationSummary,
} from './real-agent-validator.js';
import { listAvailableAgents } from '../agents/agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let agentArg = 'ts-solver';
  let releaseArg = 'dataset/releases/v0.1.0.json';
  let trials = 2;
  let timeoutSec = 300;
  let limit: number | undefined;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent' || arg === '-a') {
      agentArg = args[++i];
    } else if (arg === '--release' || arg === '-r') {
      releaseArg = args[++i];
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
TypeBench - Real-Agent Benchmark Execution & Validation Runner

Usage:
  npx tsx harness/run-real-agent.ts [options]

Options:
  -a, --agent <name>       Name of real coding agent (default: ts-solver | available: ${listAvailableAgents().join(', ')})
  -r, --release <path>     Path to frozen release checkpoint (default: dataset/releases/v0.1.0.json)
  -n, --trials <n>         Number of independent repeated trials per task (default: 2)
  --timeout <seconds>      Uniform task timeout in seconds (default: 300)
  -l, --limit <n>          Limit evaluation to first N tasks
  -v, --verbose            Show detailed agent steps, patch diffs, and evaluation logs
  -h, --help               Show help
`);
      process.exit(0);
    }
  }

  const report = await validateRealAgentExecution(agentArg, releaseArg, {
    trials,
    limit,
    timeoutSec,
    verbose,
  });

  console.log(formatAgentValidationSummary(report));
}

main().catch((err) => {
  console.error('Fatal real agent validation error:', err);
  process.exit(1);
});
