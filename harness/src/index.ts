#!/usr/bin/env node

/**
 * Typebench CLI Entrypoint
 * Usage:
 *   typebench run <task_id> --agent <name>
 *   typebench run-all --agent <name>
 */

import { Command } from 'commander';
import { DockerSandbox } from './docker/index.js';
import { BenchmarkScorer } from './scoring/index.js';
import { RunOptions, ScoreReport } from './types.js';

const program = new Command();

program
  .name('typebench')
  .description('Typebench - Benchmark for evaluating AI coding agents on TypeScript tasks')
  .version('0.1.0');

program
  .command('run <taskId>')
  .description('Run a specific benchmark task against an agent')
  .requiredOption('-a, --agent <agentName>', 'Name of the agent adapter to evaluate')
  .option('-t, --timeout <timeout>', 'Task execution timeout in seconds', '600')
  .option('--no-sandbox', 'Run locally without Docker sandbox')
  .action(async (taskId: string, options: { agent: string; timeout: string; sandbox: boolean }) => {
    const runOpts: RunOptions = {
      taskId,
      agentName: options.agent,
      timeout: parseInt(options.timeout, 10),
      sandbox: options.sandbox,
    };

    console.log(`\n⚡ Starting Typebench evaluation...`);
    console.log(`Task: ${runOpts.taskId} | Agent: ${runOpts.agentName}`);

    const sandbox = new DockerSandbox();
    const scorer = new BenchmarkScorer();

    const startTime = Date.now();

    // Stub execution flow
    const report: ScoreReport = {
      taskId: runOpts.taskId,
      agentName: runOpts.agentName,
      passed: true,
      durationMs: Date.now() - startTime,
      exitCode: 0,
      output: 'Task executed stub successfully.',
      timestamp: new Date().toISOString(),
    };

    await scorer.recordResult(report);
    console.log(scorer.formatSummary(report));
  });

program
  .command('run-all')
  .description('Run all benchmark tasks against an agent')
  .requiredOption('-a, --agent <agentName>', 'Name of the agent adapter to evaluate')
  .action(async (options: { agent: string }) => {
    console.log(`\n⚡ Running full Typebench suite for agent: ${options.agent}`);
    console.log('[Stub] Suite runner not yet fully implemented.');
  });

program.parse(process.argv);
