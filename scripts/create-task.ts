/**
 * TypeBench Task Creation Utility
 * Converts validated historical candidate commits into standardized TypeBench task packages
 * under tasks/<task-id>/, ensuring ground truth solutions and patches are strictly separated.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CandidateCommit } from './candidate-discovery.js';
import { ValidationReport, ValidationStatus, detectTestCommand } from './validate-candidate.js';
import { findSeedRepo } from './clone-repo.js';

export type TaskStatus = 'ready' | 'needs-review' | 'rejected';

export interface TaskConfig {
  taskId: string;
  repository: string;
  repositoryUrl: string;
  baseCommit: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  title: string;
  description: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  testCommand: string;
  targetedTests?: string[];
  taskStatus: TaskStatus;
  createdAt: string;
}

export interface TaskMetadata {
  taskId: string;
  repository: string;
  repositoryUrl: string;
  commitSha: string;
  parentSha: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  title: string;
  description: string;
  changedFiles: string[];
  sourceFiles: string[];
  testFiles: string[];
  validationStatus: ValidationStatus;
  validationReason: string;
  taskStatus: TaskStatus;
  candidateScore: number;
  signals: {
    positive: string[];
    negative: string[];
  };
  originalCommitMessage: string;
  createdAt: string;
}

export interface CreateTaskOptions {
  outputBaseDir?: string;
  workspacePath?: string;
  force?: boolean;
}

export interface CreateTaskResult {
  success: boolean;
  taskId: string;
  taskDir: string;
  taskConfig: TaskConfig;
  metadata: TaskMetadata;
  promptContent: string;
  error?: string;
}

/**
 * Converts a raw commit message into a clean, concise, human-readable task title.
 */
export function generateTaskTitle(commitMessage: string, category = 'bug_fix'): string {
  const firstLine = commitMessage.split('\n')[0].trim();

  // Strip conventional commit prefixes e.g. "fix(query): add foo", "feat: bar", "fix: baz"
  let clean = firstLine.replace(
    /^(fix|feat|chore|refactor|perf|test|docs|style|types?|ci|build)(\([^)]+\))?!?:?\s*/i,
    ''
  ).trim();

  // Remove trailing issue references like "(#1234)" or "close #123"
  clean = clean.replace(/\s*\(#\d+\)$/i, '');
  clean = clean.replace(/\s*closes?\s*#\d+/i, '');

  if (!clean) {
    clean = category === 'bug_fix' ? 'Resolve type and runtime issue' : 'Implement required behavior';
  }

  // Capitalize first letter of each major word
  const words = clean.split(/\s+/);
  const formatted = words
    .map((w, index) => {
      const lower = w.toLowerCase();
      // Keep acronyms/special words or capitalize
      if (w === w.toUpperCase() && w.length > 1) return w;
      if (index > 0 && ['a', 'an', 'the', 'in', 'on', 'of', 'for', 'to', 'with', 'and', 'or'].includes(lower)) {
        return lower;
      }
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');

  return formatted;
}

/**
 * Derives the task difficulty estimation based on changed files count and signals.
 */
export function estimateDifficulty(
  candidate: CandidateCommit
): 'easy' | 'medium' | 'hard' {
  const totalFiles = (candidate.changedFiles || []).length;
  const isTypeOnly = candidate.category === 'type_fix';

  if (totalFiles <= 2 && !isTypeOnly) {
    return 'easy';
  }
  if (totalFiles > 6 || (isTypeOnly && totalFiles > 3)) {
    return 'hard';
  }
  return 'medium';
}

/**
 * Generates the agent-facing prompt.md content.
 * CRITICAL: Must not leak the historical commit SHA, expected diffs, or ground truth patch.
 */
export function generatePromptContent(params: {
  title: string;
  repository: string;
  category: string;
  packageManager: string;
  testCommand: string;
  candidate: CandidateCommit;
  validationReport?: ValidationReport;
}): string {
  const { title, repository, category, packageManager, testCommand, candidate } = params;

  // Extract relevant module/package hints without revealing line-level diffs
  const impactedPackages = new Set<string>();
  for (const file of candidate.sourceFiles || []) {
    const parts = file.split('/');
    if (parts[0] === 'packages' && parts.length > 1) {
      impactedPackages.add(`packages/${parts[1]}`);
    } else if (parts.length > 1) {
      impactedPackages.add(parts[0]);
    }
  }

  const packageList = impactedPackages.size > 0
    ? Array.from(impactedPackages).join(', ')
    : 'the core repository modules';

  const categoryName = category.replace('_', ' ');

  const lines: string[] = [];

  lines.push(`# Task: ${title}\n`);
  lines.push(`## Problem Overview`);
  lines.push(
    `An issue has been identified in **${repository}** affecting ${packageList}. The current codebase exhibits unexpected behavior or lacks full support for this feature under specific TypeScript configurations and usage patterns.\n`
  );

  lines.push(`## Problem Description`);
  lines.push(
    `When interacting with the affected module(s), the expected behavior or type resolution is not properly maintained. You are tasked with resolving this ${categoryName} in the codebase.\n`
  );

  lines.push(`## Expected Behavior`);
  lines.push(`1. Ensure all relevant typings and runtime implementations satisfy the intended capability: **${title}**.`);
  lines.push(`2. Preserve correct TypeScript type inference without introducing \`any\` casts or regressions.`);
  lines.push(`3. Maintain full backwards compatibility across related APIs.\n`);

  lines.push(`## Scope & Constraints`);
  lines.push(`- Do not alter public package configurations or remove existing exports unless required.`);
  lines.push(`- Keep your modifications focused strictly on the relevant source files and logic.`);
  lines.push(`- All TypeScript type checks (\`tsc --noEmit\` or equivalent) must pass cleanly.\n`);

  lines.push(`## Verification`);
  lines.push(`You can verify your solution using the repository's test runner:`);
  lines.push('```bash');
  lines.push(`${testCommand}`);
  lines.push('```');

  if (candidate.testFiles && candidate.testFiles.length > 0) {
    lines.push('\nRelevant test suites:');
    candidate.testFiles.slice(0, 3).forEach((t) => {
      lines.push(`- \`${t}\``);
    });
  }

  return lines.join('\n') + '\n';
}

/**
 * Creates a standardized TypeBench task directory for a candidate and validation report.
 */
export async function createBenchmarkTask(
  candidate: CandidateCommit,
  validationReport: ValidationReport,
  options: CreateTaskOptions = {}
): Promise<CreateTaskResult> {
  const baseDir = options.outputBaseDir ?? path.resolve(process.cwd(), 'tasks');
  const repoName = validationReport.repository;
  const taskId = `${repoName}-${candidate.shortSha}`;
  const taskDir = path.join(baseDir, taskId);

  // Reject invalid candidates
  if (validationReport.status === 'invalid') {
    return {
      success: false,
      taskId,
      taskDir,
      taskConfig: null as any,
      metadata: null as any,
      promptContent: '',
      error: `Cannot create task: candidate was evaluated as invalid (${validationReport.validationReason}).`,
    };
  }

  // Base commit MUST be the parent commit (the pre-fix baseline)
  const baseCommit = candidate.parentSha || validationReport.parentSha;
  if (!baseCommit) {
    return {
      success: false,
      taskId,
      taskDir,
      taskConfig: null as any,
      metadata: null as any,
      promptContent: '',
      error: 'Cannot create task: candidate has no parent commit SHA.',
    };
  }

  // Determine task readiness
  const isFullyValidated =
    validationReport.status === 'baseline-fails-fixed-passes' ||
    validationReport.status === 'validated-no-regression-test';

  const taskStatus: TaskStatus = isFullyValidated ? 'ready' : 'needs-review';

  const seedRepo = findSeedRepo(repoName);
  const repositoryUrl = seedRepo?.url || `https://github.com/${repoName}/${repoName}`;

  // Determine test command
  let packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm';
  let testCommand = 'npm test';

  if (options.workspacePath && fs.existsSync(options.workspacePath)) {
    const testConfig = detectTestCommand(options.workspacePath, candidate.testFiles);
    if (testConfig.packageManager === 'unknown') {
  throw new Error(
    `Unable to detect package manager for the candidate commit.`,
  );
}

packageManager = testConfig.packageManager;
    testCommand = testConfig.targetedCommand || testConfig.testCommand;
  } else if (validationReport.baseline && validationReport.baseline.command && validationReport.baseline.command !== 'none') {
    testCommand = validationReport.baseline.command;
    if (testCommand.startsWith('pnpm')) packageManager = 'pnpm';
    else if (testCommand.startsWith('yarn')) packageManager = 'yarn';
  }

  const title = generateTaskTitle(candidate.message, candidate.category);
  const difficulty = estimateDifficulty(candidate);
  const createdAt = new Date().toISOString();

  // 1. Agent-facing task configuration (NO ground-truth commit SHA or diffs)
  const taskConfig: TaskConfig = {
    taskId,
    repository: repoName,
    repositoryUrl,
    baseCommit,
    category: candidate.category,
    difficulty,
    title,
    description: `Task for ${repoName}: ${title}`,
    packageManager,
    testCommand,
    targetedTests: candidate.testFiles || [],
    taskStatus,
    createdAt,
  };

  // 2. Internal benchmark metadata (Full ground truth)
  const metadata: TaskMetadata = {
    taskId,
    repository: repoName,
    repositoryUrl,
    commitSha: candidate.sha,
    parentSha: baseCommit,
    category: candidate.category,
    difficulty,
    title,
    description: `Task for ${repoName}: ${title}`,
    changedFiles: candidate.changedFiles || [],
    sourceFiles: candidate.sourceFiles || [],
    testFiles: candidate.testFiles || [],
    validationStatus: validationReport.status,
    validationReason: validationReport.validationReason,
    taskStatus,
    candidateScore: candidate.score,
    signals: candidate.signals,
    originalCommitMessage: candidate.message,
    createdAt,
  };

  // 3. Agent-facing prompt content
  const promptContent = generatePromptContent({
    title,
    repository: repoName,
    category: candidate.category,
    packageManager,
    testCommand,
    candidate,
    validationReport,
  });

  // Write files to disk
  fs.mkdirSync(taskDir, { recursive: true });

  fs.writeFileSync(
    path.join(taskDir, 'task.json'),
    JSON.stringify(taskConfig, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(taskDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(taskDir, 'prompt.md'),
    promptContent,
    'utf-8'
  );

  return {
    success: true,
    taskId,
    taskDir,
    taskConfig,
    metadata,
    promptContent,
  };
}

// Standalone CLI support for create-task
async function main() {
  const args = process.argv.slice(2);
  let repoName: string | undefined;
  let commitQuery: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' || arg === '-r') {
      repoName = args[++i];
    } else if (arg === '--commit' || arg === '-c') {
      commitQuery = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Task Creation Utility

Usage:
  npx tsx scripts/create-task.ts --repo <name> --commit <sha>

Options:
  -r, --repo <name>    Repository name in results/validation/ (e.g. trpc, zod)
  -c, --commit <sha>   Validation report short SHA (e.g. c7360d4)
  -h, --help           Show help
`);
      process.exit(0);
    }
  }

  if (!repoName || !commitQuery) {
    console.error('Error: Please provide both --repo <name> and --commit <sha>');
    process.exit(1);
  }

  const validationPath = path.resolve(
    process.cwd(),
    'results/validation',
    repoName,
    `${commitQuery}.json`
  );

  if (!fs.existsSync(validationPath)) {
    console.error(`Validation report not found at: ${validationPath}`);
    process.exit(1);
  }

  const validationReport: ValidationReport = JSON.parse(
    fs.readFileSync(validationPath, 'utf-8')
  );

  // Construct candidate commit structure from validation report
  const candidate: CandidateCommit = {
    sha: validationReport.commitSha,
    shortSha: validationReport.shortSha,
    message: `Fix issue in ${repoName}`,
    author: 'TypeBench Validator',
    authorEmail: 'benchmark@typebench.org',
    date: validationReport.timestamp,
    parentSha: validationReport.parentSha,
    isCandidate: true,
    score: 5,
    category: 'bug_fix',
    signals: { positive: ['validated-commit'], negative: [] },
    hasTestsChanged: (validationReport.tests || []).length > 0,
    testFiles: validationReport.tests || [],
    sourceFiles: [],
    docFiles: [],
    configFiles: [],
    changedFiles: validationReport.tests || [],
  };

  const result = await createBenchmarkTask(candidate, validationReport);
  if (!result.success) {
    console.error(`Failed to create task: ${result.error}`);
    process.exit(1);
  }

  console.log(`\n[TypeBench] Benchmark task created successfully!`);
  console.log(`Task ID  : ${result.taskId}`);
  console.log(`Location : ${result.taskDir}`);
  console.log(`Status   : ${result.taskConfig.taskStatus}`);
  console.log(`Base SHA : ${result.taskConfig.baseCommit.slice(0, 7)}`);
  console.log(`Title    : ${result.taskConfig.title}\n`);
}

if (process.argv[1]?.includes('create-task')) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
