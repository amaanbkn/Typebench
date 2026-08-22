#!/usr/bin/env node

/**
 * TypeBench Agent Execution CLI
 * Usage:
 *   npx tsx agents/run-agent.ts --task tasks/trpc-c7360d4 --agent mock [--verbose]
 */

import { executeAgentOnTask, listAvailableAgents } from './agent-runner.js';

async function main() {
  const args = process.argv.slice(2);
  let taskPath: string | undefined;
  let agentName = 'mock';
  let timeoutSec = 300;
  let verbose = false;
  let keepWorkspace = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--task' || arg === '-t') {
      taskPath = args[++i];
    } else if (arg === '--agent' || arg === '-a') {
      agentName = args[++i];
    } else if (arg === '--timeout') {
      timeoutSec = parseInt(args[++i], 10);
    } else if (arg === '--keep-workspace') {
      keepWorkspace = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Agent Execution Runner

Usage:
  npx tsx agents/run-agent.ts --task <path-to-task> --agent <agent-name> [options]

Options:
  -t, --task <path>      Path to task directory (e.g. tasks/trpc-c7360d4) or task.json
  -a, --agent <name>     Name of agent adapter (available: ${listAvailableAgents().join(', ')})
  --timeout <seconds>    Execution timeout in seconds (default: 300)
  --keep-workspace       Preserve the temporary workspace directory after run
  -v, --verbose          Show detailed execution logs
  -h, --help             Show help
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !taskPath) {
      taskPath = arg;
    }
  }

  if (!taskPath) {
    console.error('Error: Please specify a task using --task <path>');
    console.log('Example: npx tsx agents/run-agent.ts --task tasks/trpc-c7360d4 --agent mock');
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`[TypeBench Agent] Starting Run`);
  console.log(`========================================\n`);
  console.log(`Task Path : ${taskPath}`);
  console.log(`Agent     : ${agentName}`);
  console.log(`Timeout   : ${timeoutSec}s\n`);

  const result = await executeAgentOnTask(taskPath, agentName, {
    timeoutSec,
    verbose,
    keepWorkspace,
  });

  const statusBadge =
    result.status === 'completed'
      ? '✅ [COMPLETED]'
      : result.status === 'failed'
      ? '❌ [FAILED]'
      : result.status === 'timeout'
      ? '⏳ [TIMEOUT]'
      : '⚠️  [INFRASTRUCTURE FAILURE]';

  console.log(`----------------------------------------`);
  console.log(`Agent Run Result: ${statusBadge}`);
  console.log(`----------------------------------------`);
  console.log(`Run ID        : ${result.runId}`);
  console.log(`Task ID       : ${result.taskId}`);
  console.log(`Agent         : ${result.agentName}`);
  console.log(`Status        : ${result.status}`);
  console.log(`Duration      : ${(result.durationMs / 1000).toFixed(2)}s`);
  console.log(`Changed Files : ${result.changedFiles.length}`);
  if (result.changedFiles.length > 0) {
    result.changedFiles.forEach((f) => console.log(`  - ${f}`));
  }
  if (result.tokensUsed) {
    console.log(`Tokens Used   : ${result.tokensUsed}`);
  }
  if (result.stdout) {
    console.log(`\n[Agent Output]:\n${result.stdout}`);
  }
  if (result.error) {
    console.log(`\n[Error Details]:\n${result.error}`);
  }

  console.log(`\nRun Artifacts : results/runs/${result.runId}/`);
  console.log(`========================================\n`);

  if (result.status !== 'completed') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal agent runner error:', err);
  process.exit(1);
});
