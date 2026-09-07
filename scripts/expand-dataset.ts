/**
 * TypeBench Dataset Expansion
 *
 * Builds the v0.2.0 candidate dataset using the canonical TypeBench pipeline:
 *
 *   Git history
 *       ↓
 *   candidate-discovery.ts
 *       ↓
 *   validate-candidate.ts
 *       ↓
 *   create-task.ts
 *
 * IMPORTANT:
 * - v0.1.0 is never modified.
 * - Historical fix commits remain internal ground truth.
 * - Only genuinely validated candidates are emitted as benchmark tasks.
 */

import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';

import chalk from 'chalk';
import { simpleGit } from 'simple-git';

import {
  discoverCandidates,
  type CandidateCommit,
} from './candidate-discovery.js';

import {
  validateCandidate,
  saveValidationReport,
  type ValidationReport,
} from './validate-candidate.js';

import {
  createBenchmarkTask,
  type CreateTaskResult,
} from './create-task.js';

import type { CommitInfo } from './git-history.js';

interface RepositoryConfig {
  name: string;
  url: string;
  category: string;
}

/**
 * Expansion repositories.
 *
 * These repositories are independent from the frozen v0.1.0 dataset.
 */
const TARGET_REPOS: RepositoryConfig[] = [
  {
    name: 'axios',
    url: 'https://github.com/axios/axios.git',
    category: 'http-client',
  },
  {
    name: 'rxjs',
    url: 'https://github.com/ReactiveX/rxjs.git',
    category: 'reactive',
  },
  {
    name: 'nestjs',
    url: 'https://github.com/nestjs/nest.git',
    category: 'backend-framework',
  },
  {
    name: 'vite',
    url: 'https://github.com/vitejs/vite.git',
    category: 'build-tool',
  },
  {
    name: 'typescript-eslint',
    url: 'https://github.com/typescript-eslint/typescript-eslint.git',
    category: 'linting',
  },
  {
    name: 'prisma',
    url: 'https://github.com/prisma/prisma.git',
    category: 'orm',
  },
  {
    name: 'type-challenges',
    url: 'https://github.com/type-challenges/type-challenges.git',
    category: 'type-exercises',
  },
  {
    name: 'vue',
    url: 'https://github.com/vuejs/core.git',
    category: 'frontend-framework',
  },
];

/**
 * Dataset target.
 *
 * This is a target rather than a guarantee. Only genuinely validated
 * candidates are allowed into the dataset.
 */
const TARGET_TASKS = 60;

/**
 * Maximum number of candidates sent through real validation
 * for each repository.
 *
 * Each validation may involve:
 *   - isolated workspace creation
 *   - dependency installation
 *   - baseline test execution
 *   - fixed test execution
 *
 * Therefore this intentionally remains conservative.
 */
const MAX_CANDIDATES_PER_REPO = 8;

/**
 * Minimum number of validated tasks we would like to obtain
 * from each repository.
 */
const MIN_TASKS_PER_REPO = 3;

/**
 * Maximum time allowed for one candidate validation.
 *
 * This includes dependency installation and test execution.
 */
const VALIDATION_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Real validation options.
 */
const VALIDATION_OPTIONS = {
  timeoutMs: VALIDATION_TIMEOUT_MS,
  installDependencies: true,
  verbose: false,
};

/**
 * Repository clone location.
 */
const BASE_PATH = path.resolve(
  process.cwd(),
  'data/repos',
);

/**
 * Internal v0.2.0 expansion dataset output.
 *
 * This is intentionally separate from the frozen v0.1.0 dataset.
 */
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'data/tasks/v0.2.0-candidates',
);

/**
 * Agent-facing generated task packages.
 */
const TASK_OUTPUT_PATH = path.resolve(
  process.cwd(),
  'tasks/v0.2.0-candidates',
);

interface ExpansionTask {
  id: string;

  version: '0.2.0';

  repository: {
    name: string;
    url: string;
    category: string;
  };

  baseCommit: string;

  /**
   * Historical fix commit.
   *
   * This field is retained only in the internal expansion dataset.
   * It must never be exposed to the benchmark agent.
   */
  hiddenFixCommit: string;

  prompt: string;

  testCommand: string;

  typecheckCommand: string;

  metadata: {
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
    filesChanged: string[];
    linesChanged: number;
    validationStatus: ValidationReport['status'];
    validationReason: string;
  };

  validation: {
    hiddenTests: string[];
    expectedPatch: string;
  };
}

interface ExpansionStats {
  repository: string;
  inspected: number;
  discovered: number;
  validated: number;
  reproducibleFixes: number;
  noRegressionValidation: number;
  unvalidated: number;
  invalid: number;
}

/**
 * Ensure expansion directories exist.
 */
async function ensureDirectories(): Promise<void> {
  await fs.ensureDir(BASE_PATH);
  await fs.ensureDir(OUTPUT_PATH);
  await fs.ensureDir(TASK_OUTPUT_PATH);

  console.log(
    chalk.gray('✓ Expansion directories ready'),
  );
}

/**
 * Clone a repository into the expansion workspace.
 *
 * A fresh clone is used so candidate discovery starts from a clean state.
 */
async function cloneRepo(
  repo: RepositoryConfig,
): Promise<string> {
  const repoPath = path.join(
    BASE_PATH,
    repo.name,
  );

  if (await fs.pathExists(repoPath)) {
    await fs.remove(repoPath);
  }

  console.log(
    chalk.gray(`  Cloning ${repo.name}...`),
  );

  const git = simpleGit();

  try {
    await git.clone(
      repo.url,
      repoPath,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Failed to clone ${repo.name}: ${message}`,
    );
  }

  return repoPath;
}

/**
 * Collect Git history in the format expected by candidate-discovery.ts.
 */
async function collectGitHistory(
  repoPath: string,
  maxCommits = 1000,
): Promise<CommitInfo[]> {
  const git = simpleGit(repoPath);

  const raw = await git.raw([
    'log',
    '--no-merges',
    '--date=iso-strict',
    '-n',
    String(maxCommits),
    '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e',
  ]);

  const records = raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean);

  const commits: CommitInfo[] = [];

  for (const record of records) {
    const fields = record.split('\x1f');

    if (fields.length < 6) {
      continue;
    }

    const [
      sha,
      parentSha,
      author,
      authorEmail,
      date,
      message,
    ] = fields;

    if (!sha || !parentSha) {
      continue;
    }

    let changedFiles: string[] = [];
    let insertions = 0;
    let deletions = 0;

    try {
      const numstat = await git.raw([
        'show',
        '--format=',
        '--numstat',
        '--no-renames',
        sha,
      ]);

      for (const line of numstat.split('\n')) {
        if (!line.trim()) {
          continue;
        }

        const parts = line.split('\t');

        if (parts.length < 3) {
          continue;
        }

        const additions = Number.parseInt(
          parts[0],
          10,
        );

        const removed = Number.parseInt(
          parts[1],
          10,
        );

        const file = parts
          .slice(2)
          .join('\t')
          .trim();

        if (!file) {
          continue;
        }

        if (Number.isFinite(additions)) {
          insertions += additions;
        }

        if (Number.isFinite(removed)) {
          deletions += removed;
        }

        changedFiles.push(file);
      }
    } catch {
      /**
       * If one commit cannot be inspected, skip it rather than
       * stopping discovery for the entire repository.
       */
      continue;
    }

    if (changedFiles.length === 0) {
      continue;
    }

    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      message,
      author,
      authorEmail,
      date,
      parentSha,
      changedFiles,
      insertions,
      deletions,
    });
  }

  return commits;
}

/**
 * Discover candidates using the canonical deterministic
 * candidate-discovery implementation.
 */
async function discoverRepoCandidates(
  repoPath: string,
): Promise<{
  commits: CommitInfo[];
  candidates: CandidateCommit[];
}> {
  const commits = await collectGitHistory(
    repoPath,
    1000,
  );

  console.log(
    chalk.gray(
      `  Analyzing ${commits.length} commits...`,
    ),
  );

  const result = discoverCandidates(
    commits,
    {
      minScore: 3,
      verbose: false,
    },
  );

  console.log(
    chalk.gray(
      `  Candidate discovery: ${result.candidates.length} candidates, ` +
        `${result.noiseFiltered.length} filtered`,
    ),
  );

  return {
    commits,
    candidates: result.candidates,
  };
}

/**
 * Convert the canonical create-task result into the internal
 * v0.2.0 dataset format.
 */
function convertTaskResult(
  repo: RepositoryConfig,
  candidate: CandidateCommit,
  validation: ValidationReport,
  result: CreateTaskResult,
): ExpansionTask {
  const taskConfig = result.taskConfig;
  const metadata = result.metadata;

  return {
    id: taskConfig.taskId,

    version: '0.2.0',

    repository: {
      name: repo.name,
      url: repo.url,
      category: repo.category,
    },

    baseCommit: taskConfig.baseCommit,

    /**
     * Internal ground truth.
     *
     * This is deliberately not copied into the agent-facing
     * task package.
     */
    hiddenFixCommit: candidate.sha,

    prompt: result.promptContent,

    testCommand: taskConfig.testCommand,

    typecheckCommand: 'npx tsc --noEmit',

    metadata: {
      category: metadata.category,
      difficulty: metadata.difficulty,
      filesChanged: metadata.changedFiles,
      linesChanged: calculateChangedLines(candidate),
      validationStatus: validation.status,
      validationReason: validation.validationReason,
    },

    validation: {
      hiddenTests: validation.tests || [],
      expectedPatch: '',
    },
  };
}

/**
 * Calculate the total number of changed lines.
 */
function calculateChangedLines(
  candidate: CandidateCommit,
): number {
  return (
    (candidate.insertions || 0) +
    (candidate.deletions || 0)
  );
}

/**
 * Only these validation outcomes are eligible for
 * benchmark task creation.
 */
function isAcceptedValidation(
  report: ValidationReport,
): boolean {
  return (
    report.status ===
      'baseline-fails-fixed-passes' ||
    report.status ===
      'validated-no-regression-test'
  );
}

/**
 * Prefer reproducible fail-to-pass candidates.
 *
 * Secondary ordering uses the deterministic candidate score.
 */
function sortValidationPreference(
  reports: Array<{
    candidate: CandidateCommit;
    report: ValidationReport;
  }>,
): Array<{
  candidate: CandidateCommit;
  report: ValidationReport;
}> {
  return [...reports].sort((a, b) => {
    const validationScore = (
      status: ValidationReport['status'],
    ): number => {
      if (
        status ===
        'baseline-fails-fixed-passes'
      ) {
        return 2;
      }

      if (
        status ===
        'validated-no-regression-test'
      ) {
        return 1;
      }

      return 0;
    };

    const statusDifference =
      validationScore(b.report.status) -
      validationScore(a.report.status);

    if (statusDifference !== 0) {
      return statusDifference;
    }

    return (
      b.candidate.score -
      a.candidate.score
    );
  });
}

/**
 * Balance the final expansion dataset.
 *
 * Maximum of 5 tasks per repository/category.
 */
function balanceDataset(
  tasks: ExpansionTask[],
): ExpansionTask[] {
  const counts = new Map<
    string,
    number
  >();

  const selected: ExpansionTask[] = [];

  /**
   * Group tasks by repository.
   */
  const repoGroups = new Map<
    string,
    ExpansionTask[]
  >();

  for (const task of tasks) {
    const repoName =
      task.repository.name;

    if (!repoGroups.has(repoName)) {
      repoGroups.set(
        repoName,
        [],
      );
    }

    repoGroups
      .get(repoName)!
      .push(task);
  }

  /**
   * First guarantee at least one task from every repository
   * that successfully produced a validated task.
   */
  for (
    const repoTasks of repoGroups.values()
  ) {
    if (repoTasks.length === 0) {
      continue;
    }

    const first = repoTasks[0];

    selected.push(first);

    const key =
      `${first.repository.name}-${first.metadata.category}`;

    counts.set(key, 1);
  }

  /**
   * Fill remaining capacity while maintaining
   * repository/category balance.
   */
  for (const task of tasks) {
    if (
      selected.some(
        (existing) =>
          existing.id === task.id,
      )
    ) {
      continue;
    }

    if (
      selected.length >= TARGET_TASKS
    ) {
      break;
    }

    const key =
      `${task.repository.name}-${task.metadata.category}`;

    const count =
      counts.get(key) || 0;

    if (count >= 5) {
      continue;
    }

    counts.set(
      key,
      count + 1,
    );

    selected.push(task);
  }

  return selected;
}

/**
 * Process a single repository.
 */
async function processRepository(
  repo: RepositoryConfig,
): Promise<{
  tasks: ExpansionTask[];
  stats: ExpansionStats;
}> {
  const repoPath =
    await cloneRepo(repo);

  const {
    commits,
    candidates,
  } =
    await discoverRepoCandidates(
      repoPath,
    );

  const stats: ExpansionStats = {
    repository: repo.name,
    inspected: commits.length,
    discovered: candidates.length,
    validated: 0,
    reproducibleFixes: 0,
    noRegressionValidation: 0,
    unvalidated: 0,
    invalid: 0,
  };

  if (candidates.length === 0) {
    console.log(
      chalk.yellow(
        `  No candidates found for ${repo.name}`,
      ),
    );

    return {
      tasks: [],
      stats,
    };
  }

  const validationResults: Array<{
    candidate: CandidateCommit;
    report: ValidationReport;
  }> = [];

  const candidatesToValidate =
    Math.min(
      candidates.length,
      MAX_CANDIDATES_PER_REPO,
    );

  console.log(
    chalk.cyan(
      `  Validating up to ${candidatesToValidate} candidates...`,
    ),
  );

  /**
   * Candidates are validated sequentially.
   *
   * This deliberately avoids running multiple repository
   * clones/tests simultaneously and exhausting system resources.
   */
  for (
    let index = 0;
    index < candidatesToValidate;
    index++
  ) {
    const candidate =
      candidates[index];

    console.log(
      chalk.gray(
        `    [${index + 1}/${candidatesToValidate}] ` +
          `${candidate.shortSha} — ${candidate.category}`,
      ),
    );

    try {
      const report =
        await validateCandidate(
          repo.name,
          repoPath,
          candidate,
          VALIDATION_OPTIONS,
        );

      saveValidationReport(report);

      if (
        report.status ===
        'baseline-fails-fixed-passes'
      ) {
        stats.reproducibleFixes++;
        stats.validated++;
      } else if (
        report.status ===
        'validated-no-regression-test'
      ) {
        stats.noRegressionValidation++;
        stats.validated++;
      } else if (
        report.status ===
        'unvalidated'
      ) {
        stats.unvalidated++;
      } else if (
        report.status ===
        'invalid'
      ) {
        stats.invalid++;
      }

      if (
        isAcceptedValidation(report)
      ) {
        validationResults.push({
          candidate,
          report,
        });

        console.log(
          chalk.green(
            `      ✓ ${report.status}`,
          ),
        );
      } else {
        console.log(
          chalk.yellow(
            `      - ${report.status}`,
          ),
        );
      }

      /**
       * If we already have enough validated
       * candidates for this repository, stop.
       *
       * This prevents spending time on weaker
       * candidates once the repository has enough
       * usable tasks.
       */
      if (
        validationResults.length >=
        MIN_TASKS_PER_REPO
      ) {
        break;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.log(
        chalk.red(
          `      ✗ Validator error: ${message}`,
        ),
      );
    }
  }

  const accepted =
    sortValidationPreference(
      validationResults,
    );

  const tasks: ExpansionTask[] = [];

  /**
   * Generate standardized task packages.
   */
  for (
    const {
      candidate,
      report,
    } of accepted
  ) {
    try {
      const result =
        await createBenchmarkTask(
          candidate,
          report,
          {
            outputBaseDir:
              TASK_OUTPUT_PATH,
            workspacePath:
              repoPath,
            force: false,
          },
        );

      if (!result.success) {
        console.log(
          chalk.yellow(
            `    Could not create task for ` +
              `${candidate.shortSha}: ${result.error}`,
          ),
        );

        continue;
      }

      const task =
        convertTaskResult(
          repo,
          candidate,
          report,
          result,
        );

      tasks.push(task);

      console.log(
        chalk.green(
          `    ✓ Task created: ${task.id}`,
        ),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.log(
        chalk.red(
          `    ✗ Task generation failed for ` +
            `${candidate.shortSha}: ${message}`,
        ),
      );
    }
  }

  console.log(
    chalk.gray(
      `  ${repo.name}: ${tasks.length} tasks created ` +
        `(${stats.reproducibleFixes} reproducible fixes, ` +
        `${stats.noRegressionValidation} other validated)`,
    ),
  );

  return {
    tasks,
    stats,
  };
}

/**
 * Write the v0.2.0 expansion dataset.
 */
async function writeDataset(
  tasks: ExpansionTask[],
  stats: ExpansionStats[],
): Promise<void> {
  const finalTasks =
    balanceDataset(tasks);

  const fingerprint =
    createHash('sha256')
      .update(
        JSON.stringify(
          finalTasks,
        ),
      )
      .digest('hex');

  const repositories = [
    ...new Set(
      finalTasks.map(
        (task) =>
          task.repository.name,
      ),
    ),
  ];

  const categories = [
    ...new Set(
      finalTasks.map(
        (task) =>
          task.metadata.category,
      ),
    ),
  ];

  const difficulties = {
    easy: finalTasks.filter(
      (task) =>
        task.metadata.difficulty ===
        'easy',
    ).length,

    medium: finalTasks.filter(
      (task) =>
        task.metadata.difficulty ===
        'medium',
    ).length,

    hard: finalTasks.filter(
      (task) =>
        task.metadata.difficulty ===
        'hard',
    ).length,
  };

  const manifest = {
    version: '0.2.0',

    generatedAt:
      new Date().toISOString(),

    taskCount:
      finalTasks.length,

    repositories,

    categories,

    difficulty:
      difficulties,

    fingerprint,

    generation: {
      targetTasks:
        TARGET_TASKS,

      maxCandidatesPerRepository:
        MAX_CANDIDATES_PER_REPO,

      minTasksPerRepository:
        MIN_TASKS_PER_REPO,

      validationTimeoutMs:
        VALIDATION_TIMEOUT_MS,
    },

    repositoryStats:
      stats,
  };

  await fs.writeJson(
    path.join(
      OUTPUT_PATH,
      'tasks.json',
    ),
    finalTasks,
    {
      spaces: 2,
    },
  );

  await fs.writeJson(
    path.join(
      OUTPUT_PATH,
      'manifest.json',
    ),
    manifest,
    {
      spaces: 2,
    },
  );

  console.log('');

  console.log(
    chalk.green.bold(
      `✓ Generated ${finalTasks.length} validated tasks`,
    ),
  );

  console.log(
    chalk.green(
      `✓ Across ${repositories.length} repositories`,
    ),
  );

  console.log(
    chalk.gray(
      `✓ Categories: ${categories.join(', ')}`,
    ),
  );

  console.log(
    chalk.gray(
      `✓ Difficulty: easy=${difficulties.easy}, ` +
        `medium=${difficulties.medium}, ` +
        `hard=${difficulties.hard}`,
    ),
  );

  console.log(
    chalk.gray(
      `✓ Fingerprint: sha256:${fingerprint}`,
    ),
  );

  console.log(
    chalk.gray(
      `✓ Dataset: ${OUTPUT_PATH}`,
    ),
  );
}

/**
 * Main expansion entry point.
 */
async function main(): Promise<void> {
  console.log(
    chalk.blue.bold(
      '\nTypeBench Dataset Expansion v0.2.0',
    ),
  );

  console.log(
    chalk.gray(
      'Using canonical discovery → validation → task creation pipeline',
    ),
  );

  console.log(
    chalk.gray(
      `Target: ${TARGET_TASKS}+ tasks across ` +
        `${TARGET_REPOS.length} repositories\n`,
    ),
  );

  await ensureDirectories();

  const allTasks: ExpansionTask[] = [];
  const allStats: ExpansionStats[] = [];

  for (
    const repo of TARGET_REPOS
  ) {
    console.log(
      chalk.yellow.bold(
        `\n=== ${repo.name} ===`,
      ),
    );

    try {
      const {
        tasks,
        stats,
      } =
        await processRepository(
          repo,
        );

      allTasks.push(
        ...tasks,
      );

      allStats.push(
        stats,
      );

      console.log(
        chalk.gray(
          `  Running total: ${allTasks.length} tasks`,
        ),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        chalk.red(
          `  Failed to process ${repo.name}: ${message}`,
        ),
      );

      allStats.push({
        repository:
          repo.name,
        inspected: 0,
        discovered: 0,
        validated: 0,
        reproducibleFixes: 0,
        noRegressionValidation: 0,
        unvalidated: 0,
        invalid: 0,
      });
    }
  }

  if (
    allTasks.length === 0
  ) {
    throw new Error(
      'No validated tasks were generated. Dataset was not written.',
    );
  }

  await writeDataset(
    allTasks,
    allStats,
  );

  console.log(
    chalk.blue.bold(
      '\nExpansion complete.',
    ),
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      chalk.red.bold(
        '\n✗ Dataset expansion failed:',
      ),
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      chalk.red(message),
    );

    process.exit(1);
  },
);