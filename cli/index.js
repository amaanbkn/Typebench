#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const isBuilt = path.basename(path.dirname(scriptDirectory)) === 'dist';
const projectDirectory = path.resolve(scriptDirectory, isBuilt ? '../..' : '..');

function runEntry(sourcePath, args = []) {
  const builtPath = path.join(
    projectDirectory,
    'dist',
    sourcePath.replace(/\.ts$/, '.js'),
  );
  const sourceFile = path.join(projectDirectory, sourcePath);
  const useBuilt = isBuilt || (existsSync(builtPath) && process.env.TYPEBENCH_SOURCE !== '1');
  const command = useBuilt
    ? [builtPath, ...args]
    : ['--import', 'tsx', sourceFile, ...args];
  const result = spawnSync(process.execPath, command, {
    cwd: projectDirectory,
    stdio: 'inherit',
  });

  process.exitCode = result.status ?? 1;
}

const program = new Command();
program
  .name('typebench')
  .description('TypeBench: benchmark AI coding agents on real TypeScript tasks')
  .version('1.0.0');

program
  .command('verify')
  .description('Verify a frozen dataset release and its task checksums')
  .option('-r, --release <path-or-version>', 'release file or version', '0.2.0')
  .action(({ release }) => runEntry('dataset/validate-release.ts', ['--release', release]));

program
  .command('readiness')
  .description('Check task metadata, prompts, and manifest consistency')
  .option('--run-sandbox', 'run task verification in Docker')
  .option('--timeout <seconds>', 'sandbox timeout per task', '180')
  .option('-v, --verbose', 'show task-level validation details')
  .action((options) => {
    const args = [];
    if (options.runSandbox) args.push('--run-sandbox');
    args.push('--timeout', options.timeout);
    if (options.verbose) args.push('--verbose');
    runEntry('dataset/validate-readiness.ts', args);
  });

program
  .command('run')
  .description('Run one trial across a frozen dataset release')
  .requiredOption('-a, --agent <name>', 'registered agent adapter')
  .option('-r, --release <path-or-version>', 'release file or version', '0.2.0')
  .option('-l, --limit <n>', 'run only the first n tasks')
  .option('--timeout <seconds>', 'task timeout', '300')
  .option('-v, --verbose', 'show detailed execution logs')
  .action((options) => {
    const args = ['--release', options.release, '--agent', options.agent, '--timeout', options.timeout];
    if (options.limit) args.push('--limit', options.limit);
    if (options.verbose) args.push('--verbose');
    runEntry('harness/run-benchmark.ts', args);
  });

program
  .command('run-all')
  .description('Run repeated trials for one agent across the frozen release')
  .requiredOption('-a, --agent <name>', 'registered agent adapter')
  .option('-r, --release <path-or-version>', 'release file or version', '0.2.0')
  .option('-n, --trials <n>', 'independent trials per task', '3')
  .option('-l, --limit <n>', 'run only the first n tasks')
  .option('--timeout <seconds>', 'task timeout', '300')
  .option('-v, --verbose', 'show detailed execution logs')
  .action((options) => {
    const args = [
      '--release',
      options.release,
      '--agents',
      options.agent,
      '--trials',
      options.trials,
      '--timeout',
      options.timeout,
    ];
    if (options.limit) args.push('--limit', options.limit);
    if (options.verbose) args.push('--verbose');
    runEntry('harness/run-protocol.ts', args);
  });

program
  .command('protocol')
  .description('Compare agents with repeated trials under Protocol v1.0.0')
  .requiredOption('-a, --agents <names>', 'comma-separated registered agent names')
  .option('-r, --release <path-or-version>', 'release file or version', '0.2.0')
  .option('-n, --trials <n>', 'independent trials per task', '3')
  .option('-l, --limit <n>', 'run only the first n tasks')
  .option('--timeout <seconds>', 'task timeout', '300')
  .option('-v, --verbose', 'show detailed execution logs')
  .action((options) => {
    const args = [
      '--release',
      options.release,
      '--agents',
      options.agents,
      '--trials',
      options.trials,
      '--timeout',
      options.timeout,
    ];
    if (options.limit) args.push('--limit', options.limit);
    if (options.verbose) args.push('--verbose');
    runEntry('harness/run-protocol.ts', args);
  });

program
  .command('validate-agent')
  .description('Run repeated end-to-end validation for one registered agent')
  .option('-a, --agent <name>', 'registered agent adapter', 'ts-solver')
  .option('-r, --release <path-or-version>', 'release file or version', '0.2.0')
  .option('-n, --trials <n>', 'independent trials per task', '3')
  .option('-l, --limit <n>', 'run only the first n tasks')
  .option('--timeout <seconds>', 'task timeout', '300')
  .option('-v, --verbose', 'show detailed execution logs')
  .action((options) => {
    const args = [
      '--agent',
      options.agent,
      '--release',
      options.release,
      '--trials',
      options.trials,
      '--timeout',
      options.timeout,
    ];
    if (options.limit) args.push('--limit', options.limit);
    if (options.verbose) args.push('--verbose');
    runEntry('harness/run-real-agent.ts', args);
  });

program
  .command('evaluate <run>')
  .description('Evaluate a saved agent run independently')
  .option('--timeout <seconds>', 'evaluation timeout', '300')
  .option('-v, --verbose', 'show detailed test output')
  .action((run, options) => {
    const args = ['--run', run, '--timeout', options.timeout];
    if (options.verbose) args.push('--verbose');
    runEntry('evaluator/evaluate-task.ts', args);
  });

program
  .command('score <evaluation>')
  .description('Score a saved evaluation')
  .option('-v, --verbose', 'show scoring details')
  .action((evaluation, options) => {
    const args = ['--evaluation', evaluation];
    if (options.verbose) args.push('--verbose');
    runEntry('scoring/score-task.ts', args);
  });

program
  .command('leaderboard')
  .description('Summarize saved benchmark run reports')
  .option('-r, --release <version>', 'only include complete runs from this release', '0.2.0')
  .action(({ release }) => runEntry('results/leaderboard/generate.ts', ['--release', release]));

program.parse();
