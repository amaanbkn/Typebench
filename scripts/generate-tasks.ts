/**
 * TypeBench Task Generator Entrypoint (Steps 1-4: Cloning, History, Candidates & Validation)
 *
 * Usage:
 *   npx tsx scripts/generate-tasks.ts --repo <name> [--history-depth <n>] [--validate] [--validate-count <n>] [--verbose]
 */

import { cloneRepository, getSeedRepos } from './clone-repo.js';
import { discoverGitHistory } from './git-history.js';
import { discoverCandidates, formatCandidateSummary } from './candidate-discovery.js';
import {
  validateCandidate,
  saveValidationReport,
  formatValidationSummary,
  ValidationReport,
} from './validate-candidate.js';
import { createBenchmarkTask, CreateTaskResult } from './create-task.js';

async function main() {
  const args = process.argv.slice(2);
  let repoQuery: string | undefined;
  let cloneDepth: number | undefined;
  let historyDepth = 20;
  let verbose = false;
  let validate = false;
  let createTasks = false;
  let validateCount: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' || arg === '-r') {
      repoQuery = args[++i];
    } else if (arg === '--history-depth') {
      historyDepth = parseInt(args[++i], 10);
    } else if (arg === '--clone-depth') {
      cloneDepth = parseInt(args[++i], 10);
    } else if (arg === '--depth' || arg === '-d') {
      historyDepth = parseInt(args[++i], 10);
    } else if (arg === '--validate') {
      validate = true;
    } else if (arg === '--create-tasks' || arg === '--create-task') {
      createTasks = true;
    } else if (arg === '--validate-count' || arg === '--limit') {
      validateCount = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Candidate Discovery, Validation & Task Creation

Usage:
  npx tsx scripts/generate-tasks.ts --repo <name> [--history-depth <n>] [--validate] [--create-tasks] [--validate-count <n>] [--verbose]

Options:
  -r, --repo <name>             Repository name from seed-repos.json or URL (e.g. trpc, zod, prisma, hono, type-challenges)
  -d, --history-depth <n>       Number of commits to discover (default: 20)
  --clone-depth <n>             Initial shallow clone depth (default: matches history-depth)
  --validate                    Validate discovered candidate commits in isolated test workspaces
  --create-tasks, --create-task Package candidate(s) into benchmark task directories under tasks/<task-id>/
  --validate-count, --limit <n> Number of top candidates to process (default: all discovered)
  -v, --verbose                 Show detailed candidate scoring, signals, and test execution output
  -h, --help                    Show help

Available repositories in seed-repos.json:
${getSeedRepos().map((r) => `  - ${r.name} (${r.url})`).join('\n')}
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !repoQuery) {
      repoQuery = arg;
    }
  }

  if (!repoQuery) {
    console.error('Error: Please specify a repository using --repo <name>');
    console.log('Available seed repositories: trpc, zod, prisma, hono, type-challenges');
    process.exit(1);
  }

  // 1. Clone repository into temporary isolated workspace
  const cloneResult = await cloneRepository(repoQuery, { depth: cloneDepth ?? historyDepth });
  if (!cloneResult.success || !cloneResult.workspacePath) {
    process.exit(1);
  }

  // 2. Discover Git history
  console.log('\n[TypeBench] Discovering Git history...');
  const historyResult = await discoverGitHistory(cloneResult.workspacePath, {
    depth: historyDepth,
    verbose,
  });

  if (!historyResult.success) {
    console.error(`[TypeBench] Error reading Git history: ${historyResult.error}`);
    process.exit(1);
  }

  if (historyResult.warning) {
    console.log(historyResult.warning);
  }

  console.log(`[TypeBench] Commits discovered: ${historyResult.totalDiscovered}\n`);

  // 3. Discover candidates from structured commit history
  const discoveryResult = discoverCandidates(historyResult.commits, { verbose });

  // 4. Output candidate summary
  console.log(formatCandidateSummary(discoveryResult, verbose));

  // 5. Candidate Validation & Task Creation
  if (validate || createTasks) {
    const candidatesToProcess = validateCount
      ? discoveryResult.candidates.slice(0, validateCount)
      : discoveryResult.candidates;

    console.log(`\n[TypeBench] Validating ${candidatesToProcess.length} candidate commit(s)...`);

    const reports: ValidationReport[] = [];
    const taskResults: CreateTaskResult[] = [];

    for (let i = 0; i < candidatesToProcess.length; i++) {
      const candidate = candidatesToProcess[i];
      console.log(`\n-> Validating [${i + 1}/${candidatesToProcess.length}] ${candidate.shortSha}: "${candidate.message.split('\n')[0]}"`);

      const report = await validateCandidate(
        cloneResult.repoName,
        cloneResult.workspacePath,
        candidate,
        { verbose, timeoutMs: 45000 }
      );

      saveValidationReport(report);
      reports.push(report);

      console.log(`   Status: ${report.status} | Reason: ${report.validationReason}`);

      // 6. Benchmark Task Creation (if --create-tasks is enabled)
      if (createTasks) {
        if (report.status === 'invalid') {
          console.log(`   [Task] Skipped task creation for invalid candidate ${candidate.shortSha}`);
        } else {
          console.log(`   [Task] Creating benchmark task package...`);
          const taskResult = await createBenchmarkTask(candidate, report, {
            workspacePath: cloneResult.workspacePath,
          });

          if (taskResult.success) {
            taskResults.push(taskResult);
            console.log(`   [Task] Created: ${taskResult.taskId} (${taskResult.taskConfig.taskStatus}) at ${taskResult.taskDir}`);
          } else {
            console.error(`   [Task] Failed to create task: ${taskResult.error}`);
          }
        }
      }
    }

    // Print final validation summary table
    console.log(formatValidationSummary(reports));

    // Print task creation summary if requested
    if (createTasks && taskResults.length > 0) {
      console.log('\n========================================');
      console.log('[TypeBench] Benchmark Tasks Created');
      console.log('========================================\n');
      taskResults.forEach((t, index) => {
        console.log(`${index + 1}. Task ID: ${t.taskId}`);
        console.log(`   Title      : ${t.taskConfig.title}`);
        console.log(`   Status     : ${t.taskConfig.taskStatus}`);
        console.log(`   Base Commit: ${t.taskConfig.baseCommit.slice(0, 7)}`);
        console.log(`   Location   : ${t.taskDir}\n`);
      });
    }
  }
}

if (process.argv[1]?.includes('generate-tasks')) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
