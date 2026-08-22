#!/usr/bin/env node

/**
 * TypeBench Multi-Agent Comparison CLI
 * Usage:
 *   npx tsx harness/compare-agents.ts --tasks tasks/trpc-c7360d4,tasks/zod-6c77d02 --agents mock,nemotron
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runBenchmarkSession, formatComparisonSummary } from './session-runner.js';
import { listAvailableAgents } from '../agents/agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let tasksArg: string | undefined;
  let agentsArg = 'mock,nemotron';
  let timeoutSec = 300;
  let verbose = false;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tasks' || arg === '-t') {
      tasksArg = args[++i];
    } else if (arg === '--agents' || arg === '-a') {
      agentsArg = args[++i];
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--session' || arg === '-s') {
      sessionId = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Multi-Agent Benchmark Execution & Comparison

Usage:
  npx tsx harness/compare-agents.ts --tasks <tasks> --agents <agents> [options]

Options:
  -t, --tasks <list>     Comma-separated task paths or IDs (e.g. tasks/trpc-c7360d4,tasks/zod-6c77d02)
  -a, --agents <list>    Comma-separated agent names (default: mock,nemotron | available: ${listAvailableAgents().join(', ')})
  -s, --session <id>     Custom benchmark session identifier
  --timeout <seconds>    Task execution timeout in seconds (default: 300)
  -v, --verbose          Show detailed step logs for each task run
  -h, --help             Show help
`);
      process.exit(0);
    }
  }

  // If no tasks provided, discover all tasks in tasks/ (excluding _template and hidden)
  let taskPaths: string[] = [];
  if (tasksArg) {
    taskPaths = tasksArg.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    const tasksDir = path.resolve(process.cwd(), 'tasks');
    if (fs.existsSync(tasksDir)) {
      taskPaths = fs
        .readdirSync(tasksDir)
        .filter((dir) => !dir.startsWith('_') && !dir.startsWith('.') && fs.existsSync(path.join(tasksDir, dir, 'task.json')))
        .map((dir) => path.join('tasks', dir));
    }
  }

  if (taskPaths.length === 0) {
    console.error('Error: No benchmark tasks found or specified.');
    console.log('Provide tasks using --tasks tasks/trpc-c7360d4,tasks/zod-6c77d02');
    process.exit(1);
  }

  const agentNames = agentsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (agentNames.length === 0) {
    console.error('Error: Please specify at least one agent with --agents <name>');
    process.exit(1);
  }

  const sessionResult = await runBenchmarkSession(taskPaths, agentNames, {
    timeoutSec,
    verbose,
    sessionId,
  });

  console.log(formatComparisonSummary(sessionResult));
}

main().catch((err) => {
  console.error('Fatal multi-agent comparison error:', err);
  process.exit(1);
});
