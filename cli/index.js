#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { verifyDataset } from './verify.js';
import { runBenchmark } from './run.js';
import { evaluateResults } from './eval.js';
import { generateLeaderboard } from './leaderboard.js';

const program = new Command();

program
  .name('typebench')
  .description('TypeBench: TypeScript benchmark for AI coding agents')
  .version('1.0.0');

program
  .command('verify')
  .description('Verify dataset integrity via fingerprint')
  .requiredOption('--dataset <version>', 'dataset version to verify')
  .action(async (opts) => {
    console.log(chalk.blue(`Verifying dataset ${opts.dataset}...`));
    const result = await verifyDataset(opts.dataset);
    if (result.valid) {
      console.log(chalk.green('✓ Dataset verified'));
      process.exit(0);
    } else {
      console.log(chalk.red(`✗ Verification failed: ${result.error}`));
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run benchmark with specified agent')
  .requiredOption('--agent <name>', 'agent to run')
  .option('--trials <n>', 'number of trials', '3')
  .option('--dataset <version>', 'dataset version', 'v1.0.0')
  .option('--output <path>', 'output directory', './results/raw')
  .action(async (opts) => {
    console.log(chalk.blue(`Running ${opts.agent} on dataset ${opts.dataset}...`));
    await runBenchmark({
      agent: opts.agent,
      trials: parseInt(opts.trials),
      datasetVersion: opts.dataset,
      outputDir: opts.output
    });
  });

program
  .command('eval')
  .description('Evaluate raw results independently')
  .requiredOption('--results <path>', 'path to raw results')
  .option('--output <path>', 'evaluation output', './results/evaluations')
  .action(async (opts) => {
    console.log(chalk.blue('Evaluating results...'));
    await evaluateResults(opts.results, opts.output);
  });

program
  .command('leaderboard')
  .description('Generate leaderboard from evaluations')
  .option('--input <path>', 'evaluations directory', './results/evaluations')
  .option('--output <path>', 'output file', './results/leaderboard.json')
  .action(async (opts) => {
    console.log(chalk.blue('Generating leaderboard...'));
    await generateLeaderboard(opts.input, opts.output);
  });

program.parse();