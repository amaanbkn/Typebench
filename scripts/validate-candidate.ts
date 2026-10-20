/**
 * TypeBench Candidate Validation
 *
 * Validates a historical candidate commit by comparing:
 *
 *   parent commit
 *        ↓
 *   baseline tests
 *        ↓
 *   candidate/fix commit
 *        ↓
 *   fixed tests
 *
 * Validation is performed inside an isolated temporary workspace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { simpleGit, type SimpleGit } from 'simple-git';

import type { CandidateCommit } from './candidate-discovery.js';

const execAsync = promisify(exec);

/**
 * Possible validation outcomes.
 */
export type ValidationStatus =
  | 'baseline-fails-fixed-passes'
  | 'validated-no-regression-test'
  | 'unvalidated'
  | 'invalid';

/**
 * Result of executing a test command.
 */
export interface TestExecutionResult {
  command: string;
  exitCode: number;
  passed: boolean;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

/**
 * Complete candidate validation report.
 */
export interface ValidationReport {
  repository: string;
  commitSha: string;
  shortSha: string;
  parentSha: string | null;

  status: ValidationStatus;
  validationReason: string;

  baseline: TestExecutionResult;
  fixed: TestExecutionResult;

  tests: string[];

  durationMs: number;
  timestamp: string;

  workspacePath?: string;

  error?: string;
}

/**
 * Validation configuration.
 */
export interface ValidationOptions {
  timeoutMs?: number;
  installDependencies?: boolean;
  keepWorkspace?: boolean;
  workspaceRoot?: string;
  verbose?: boolean;
}

/**
 * Information returned by test-command detection.
 *
 * This shape is intentionally compatible with create-task.ts.
 */
export interface TestCommandDetection {
  packageManager:
    | 'bun'
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'unknown';

  testCommand: string;

  targetedCommand?: string;

  /**
   * Alias retained for compatibility with callers that expect
   * a generic command field.
   */
  command: string;
}

const DEFAULT_TIMEOUT_MS =
  10 * 60 * 1000;

const DEFAULT_WORKSPACE_ROOT =
  path.join(
    os.tmpdir(),
    'typebench-validation',
  );

const VALIDATION_REPORTS_DIR =
  path.resolve(
    process.cwd(),
    'data',
    'validation-reports',
  );

/**
 * Detect the package manager used by a repository.
 */
function detectPackageManager(
  workspacePath: string,
): TestCommandDetection['packageManager'] {
  if (
    fs.existsSync(
      path.join(
        workspacePath,
        'bun.lock',
      ),
    ) ||
    fs.existsSync(
      path.join(
        workspacePath,
        'bun.lockb',
      ),
    )
  ) {
    return 'bun';
  }

  if (
    fs.existsSync(
      path.join(
        workspacePath,
        'pnpm-lock.yaml',
      ),
    )
  ) {
    return 'pnpm';
  }

  if (
    fs.existsSync(
      path.join(
        workspacePath,
        'yarn.lock',
      ),
    ) ||
    fs.existsSync(
      path.join(
        workspacePath,
        'yarn.lock.yml',
      ),
    )
  ) {
    return 'yarn';
  }

  if (
    fs.existsSync(
      path.join(
        workspacePath,
        'package-lock.json',
      ),
    ) ||
    fs.existsSync(
      path.join(
        workspacePath,
        'npm-shrinkwrap.json',
      ),
    )
  ) {
    return 'npm';
  }

  if (
    fs.existsSync(
      path.join(
        workspacePath,
        'package.json',
      ),
    )
  ) {
    return 'npm';
  }

  return 'unknown';
}

/**
 * Read package.json safely.
 */
function readPackageJson(
  workspacePath: string,
): Record<string, unknown> | null {
  const packagePath =
    path.join(
      workspacePath,
      'package.json',
    );

  if (!fs.existsSync(packagePath)) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        packagePath,
        'utf8',
      ),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Quote a shell argument.
 */
function quoteShellArgument(
  value: string,
): string {
  if (
    /^[a-zA-Z0-9_./:@+-]+$/.test(value)
  ) {
    return value;
  }

  return `'${value.replaceAll(
    "'",
    "'\\''",
  )}'`;
}

/**
 * Build the normal test command for a package manager.
 */
function buildTestCommand(
  packageManager:
    | 'bun'
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'unknown',
): string {
  switch (packageManager) {
    case 'bun':
      return 'bun run test';

    case 'pnpm':
      return 'pnpm test';

    case 'yarn':
      return 'yarn test';

    case 'npm':
      return 'npm test';

    default:
      return 'npm test';
  }
}

/**
 * Build a targeted test command.
 */
function buildTargetedCommand(
  packageManager:
    | 'bun'
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'unknown',
  testFiles: string[],
): string | undefined {
  if (testFiles.length === 0) {
    return undefined;
  }

  const paths =
    testFiles
      .map(quoteShellArgument)
      .join(' ');

  switch (packageManager) {
    case 'bun':
      return `bun run test -- ${paths}`;

    case 'pnpm':
      return `pnpm test -- ${paths}`;

    case 'yarn':
      return `yarn test ${paths}`;

    case 'npm':
      return `npm test -- ${paths}`;

    default:
      return `npm test -- ${paths}`;
  }
}

/**
 * Detect the appropriate repository test command.
 *
 * IMPORTANT:
 * This returns an object because create-task.ts expects:
 *
 *   testConfig.packageManager
 *   testConfig.targetedCommand
 *   testConfig.testCommand
 */
export function detectTestCommand(
  workspacePath: string,
  targetedTests: string[] = [],
): TestCommandDetection {
  const packageJson =
    readPackageJson(workspacePath);

  const scriptsValue =
    packageJson?.scripts;

  const scripts =
    scriptsValue &&
    typeof scriptsValue === 'object'
      ? scriptsValue as Record<
          string,
          unknown
        >
      : {};

  const packageManager =
    detectPackageManager(
      workspacePath,
    );

  let testCommand =
    buildTestCommand(
      packageManager,
    );

  /**
   * Prefer the repository's standard test script.
   */
  if (
    typeof scripts.test === 'string'
  ) {
    testCommand =
      buildTestCommand(
        packageManager,
      );
  } else if (
    typeof scripts['test:unit'] ===
    'string'
  ) {
    switch (packageManager) {
      case 'bun':
        testCommand = 'bun run test:unit';
        break;

      case 'pnpm':
        testCommand =
          'pnpm run test:unit';
        break;

      case 'yarn':
        testCommand =
          'yarn test:unit';
        break;

      default:
        testCommand =
          'npm run test:unit';
        break;
    }
  } else if (
    typeof scripts.jest === 'string'
  ) {
    switch (packageManager) {
      case 'bun':
        testCommand = 'bun run jest';
        break;

      case 'pnpm':
        testCommand =
          'pnpm run jest';
        break;

      case 'yarn':
        testCommand =
          'yarn jest';
        break;

      default:
        testCommand =
          'npm run jest';
        break;
    }
  }

  const targetedCommand =
    buildTargetedCommand(
      packageManager,
      targetedTests,
    );

  return {
    packageManager,
    testCommand,
    targetedCommand,
    command: testCommand,
  };
}

/**
 * Execute a shell command with a timeout.
 */
async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  environment: Record<
    string,
    string
  > = {},
): Promise<TestExecutionResult> {
  const startedAt =
    Date.now();

  try {
    const result =
      await execAsync(
        command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer:
            20 * 1024 * 1024,
          env: {
            ...process.env,
            ...environment,
          },
        },
      );

    return {
      command,
      exitCode: 0,
      passed: true,
      timedOut: false,
      stdout:
        result.stdout || '',
      stderr:
        result.stderr || '',
      durationMs:
        Date.now() - startedAt,
    };
  } catch (
    error: unknown
  ) {
    const execError =
      error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        signal?: string;
        message?: string;
      };

    const message =
      execError?.message ||
      String(error);

    const timedOut =
      execError?.killed === true ||
      execError?.signal ===
        'SIGTERM' ||
      message
        .toLowerCase()
        .includes('timeout');

    const numericCode =
      typeof execError?.code ===
      'number'
        ? execError.code
        : 1;

    return {
      command,
      exitCode:
        numericCode,
      passed: false,
      timedOut,
      stdout:
        execError?.stdout || '',
      stderr:
        execError?.stderr || '',
      durationMs:
        Date.now() - startedAt,
      error: message,
    };
  }
}

/**
 * Install dependencies for a repository.
 */
async function ensureDependencies(
  workspacePath: string,
  packageManager:
    | 'bun'
    | 'npm'
    | 'pnpm'
    | 'yarn'
    | 'unknown',
  timeoutMs: number,
  verbose: boolean,
  testFiles: string[] = [],
  testWorkspacePackages: string[] = [],
): Promise<void> {
  const nodeModules =
    path.join(
      workspacePath,
      'node_modules',
    );

  if (
    fs.existsSync(nodeModules)
  ) {
    if (verbose) {
      console.log(
        '      Dependencies already installed',
      );
    }

    return;
  }

  let installCommand: string;

  switch (packageManager) {
    case 'bun':
      installCommand =
        'bun install --frozen-lockfile';
      break;

    case 'pnpm':
      const packagePath = findWorkspacePackage(workspacePath, testFiles);
      const packageFilters = [
        ...new Set(
          [packagePath, ...testWorkspacePackages]
            .filter((value): value is string => Boolean(value))
            .map((value) => `--filter '${value}...'`),
        ),
      ];
      installCommand = packageFilters.length > 0
        ? `pnpm install --frozen-lockfile --filter . ${packageFilters.join(' ')}`
        : 'pnpm install --frozen-lockfile';
      break;

    case 'yarn':
      installCommand =
        'yarn install --frozen-lockfile';
      break;

    case 'npm':
      installCommand = fs.existsSync(
        path.join(workspacePath, 'package-lock.json'),
      )
        ? 'npm ci'
        : 'npm install';
      break;

    default:
      installCommand =
        'npm install';
      break;
  }

  if (verbose) {
    console.log(
      `      Installing dependencies: ${installCommand}`,
    );
  }

  const result =
    await runCommand(
      installCommand,
      workspacePath,
      timeoutMs,
      {
        CI: 'true',
        NODE_ENV: 'test',
      },
    );

  if (!result.passed) {
    throw new Error(
      [
        'Dependency installation failed.',
        result.error,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function findWorkspacePackage(workspacePath: string, testFiles: string[]): string | undefined {
  for (const testFile of testFiles) {
    let currentDirectory = path.resolve(workspacePath, path.dirname(testFile));
    while (
      currentDirectory !== workspacePath &&
      currentDirectory.startsWith(`${workspacePath}${path.sep}`)
    ) {
      if (fs.existsSync(path.join(currentDirectory, 'package.json'))) {
        return `./${path.relative(workspacePath, currentDirectory)}`;
      }
      currentDirectory = path.dirname(currentDirectory);
    }
  }

  return undefined;
}

/**
 * Run a test command.
 */
async function runTestCommand(
  command: string,
  workspacePath: string,
  timeoutMs: number,
): Promise<TestExecutionResult> {
  return runCommand(
    command,
    workspacePath,
    timeoutMs,
    {
      CI: 'true',
      NODE_ENV: 'test',
    },
  );
}

/**
 * Create a unique isolated workspace.
 */
async function createWorkspace(
  repository: string,
  workspaceRoot: string,
): Promise<string> {
  await fs.promises.mkdir(
    workspaceRoot,
    {
      recursive: true,
    },
  );

  const safeRepository =
    repository.replace(
      /[^a-zA-Z0-9._-]/g,
      '-',
    );

  return fs.promises.mkdtemp(
    path.join(
      workspaceRoot,
      `${safeRepository}-`,
    ),
  );
}

/**
 * Clone a repository into the validation workspace.
 */
async function cloneIntoWorkspace(
  sourceRepositoryPath: string,
  workspacePath: string,
): Promise<SimpleGit> {
  const git =
    simpleGit();

  await git.clone(
    sourceRepositoryPath,
    workspacePath,
  );

  return simpleGit(
    workspacePath,
  );
}

/**
 * Checkout a specific commit cleanly.
 */
async function checkoutCommit(
  git: SimpleGit,
  commitSha: string,
): Promise<void> {
  await git.reset([
    '--hard',
  ]);

  await git.clean(
    'f',
    ['-d'],
  );

  await git.checkout(
    commitSha,
  );
}

async function applyCandidateTests(
  git: SimpleGit,
  commitSha: string,
  testFiles: string[],
  workspacePath: string,
): Promise<void> {
  for (const testFile of testFiles) {
    const content = await git.show(`${commitSha}:${testFile}`);
    const destination = path.resolve(workspacePath, testFile);
    const relativePath = path.relative(workspacePath, destination);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Candidate test path escapes repository: ${testFile}`);
    }

    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, content, 'utf8');
  }
}

/**
 * Check whether the workspace contains package.json.
 */
function hasPackageManifest(
  workspacePath: string,
): boolean {
  return fs.existsSync(
    path.join(
      workspacePath,
      'package.json',
    ),
  );
}

/**
 * Validate one historical candidate.
 */
export async function validateCandidate(
  repository: string,
  sourceRepositoryPath: string,
  candidate: CandidateCommit,
  options: ValidationOptions = {},
): Promise<ValidationReport> {
  const startedAt =
    Date.now();

  const timeoutMs =
    options.timeoutMs ??
    DEFAULT_TIMEOUT_MS;

  const workspaceRoot =
    options.workspaceRoot ??
    DEFAULT_WORKSPACE_ROOT;

  const keepWorkspace =
    options.keepWorkspace ??
    false;

  const installDependencies =
    options.installDependencies ??
    true;

  const verbose =
    options.verbose ??
    false;

  const parentSha =
    candidate.parentSha ||
    null;

  const emptyResult =
    (
      command: string,
    ): TestExecutionResult => ({
      command,
      exitCode: 1,
      passed: false,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 0,
    });

  let workspacePath:
    | string
    | undefined;

  let baseline =
    emptyResult('');

  let fixed =
    emptyResult('');

  /**
   * A commit without a parent cannot form a benchmark
   * parent→fix transition.
   */
  if (!parentSha) {
    return {
      repository,
      commitSha:
        candidate.sha,
      shortSha:
        candidate.shortSha,
      parentSha: null,

      status: 'invalid',

      validationReason:
        'Candidate has no parent commit.',

      baseline,
      fixed,

      tests:
        candidate.testFiles || [],

      durationMs:
        Date.now() - startedAt,

      timestamp:
        new Date().toISOString(),

      error:
        'Missing parent commit.',
    };
  }

  try {
    /**
     * Create isolated workspace.
     */
    workspacePath =
      await createWorkspace(
        repository,
        workspaceRoot,
      );

    if (verbose) {
      console.log(
        `      Workspace: ${workspacePath}`,
      );
    }

    /**
     * Clone source repository.
     */
    const git =
      await cloneIntoWorkspace(
        sourceRepositoryPath,
        workspacePath,
      );

    /**
     * -----------------------------------------
     * BASELINE
     * -----------------------------------------
     */

    await checkoutCommit(
      git,
      parentSha,
    );

    if (
      !hasPackageManifest(
        workspacePath,
      )
    ) {
      return {
        repository,
        commitSha:
          candidate.sha,
        shortSha:
          candidate.shortSha,
        parentSha,

        status: 'invalid',

        validationReason:
          'Baseline commit does not contain package.json.',

        baseline,
        fixed,

        tests:
          candidate.testFiles || [],

        durationMs:
          Date.now() - startedAt,

        timestamp:
          new Date().toISOString(),

        workspacePath:
          keepWorkspace
            ? workspacePath
            : undefined,

        error:
          'package.json not found.',
      };
    }

    const baselineConfig =
      detectTestCommand(
        workspacePath,
        candidate.testFiles ||
          [],
      );

    await applyCandidateTests(
      git,
      candidate.sha,
      candidate.testFiles || [],
      workspacePath,
    );

    /**
     * create-task.ts expects these fields, while the actual
     * validator uses the selected command for execution.
     */
    const baselineTestCommand =
      candidate.targetedTestCommand ||
      baselineConfig.targetedCommand ||
      baselineConfig.testCommand;

    if (verbose) {
      console.log(
        `      Baseline test command: ${baselineTestCommand}`,
      );
    }

    if (installDependencies) {
      await ensureDependencies(
        workspacePath,
        baselineConfig.packageManager,
        timeoutMs,
        verbose,
        candidate.testFiles || [],
        candidate.testWorkspacePackages || [],
      );
    }

    /**
     * Run baseline tests.
     */
    baseline =
      await runTestCommand(
        baselineTestCommand,
        workspacePath,
        timeoutMs,
      );

    if (verbose) {
      console.log(
        `      Baseline result: ${
          baseline.passed
            ? 'PASS'
            : 'FAIL'
        }`,
      );
    }

    /**
     * -----------------------------------------
     * FIXED VERSION
     * -----------------------------------------
     */

    await checkoutCommit(
      git,
      candidate.sha,
    );

    const fixedConfig =
      detectTestCommand(
        workspacePath,
        candidate.testFiles ||
          [],
      );

    const fixedTestCommand =
      candidate.targetedTestCommand ||
      fixedConfig.targetedCommand ||
      fixedConfig.testCommand;

    /**
     * If dependency manifests changed as part of the fix,
     * reinstall dependencies for the fixed revision.
     */
    const dependencyFilesChanged =
      (
        candidate.changedFiles ||
        []
      ).some(
        (file) =>
          file ===
            'package.json' ||
          file ===
            'package-lock.json' ||
          file ===
            'pnpm-lock.yaml' ||
          file ===
            'bun.lock' ||
          file ===
            'bun.lockb' ||
          file ===
            'yarn.lock',
      );

    if (
      installDependencies &&
      dependencyFilesChanged
    ) {
      const nodeModules =
        path.join(
          workspacePath,
          'node_modules',
        );

      await fs.promises.rm(
        nodeModules,
        {
          recursive: true,
          force: true,
        },
      );

      await ensureDependencies(
        workspacePath,
        fixedConfig.packageManager,
        timeoutMs,
        verbose,
        candidate.testFiles || [],
        candidate.testWorkspacePackages || [],
      );
    }

    if (verbose) {
      console.log(
        `      Fixed test command: ${fixedTestCommand}`,
      );
    }

    /**
     * Run fixed tests.
     */
    fixed =
      await runTestCommand(
        fixedTestCommand,
        workspacePath,
        timeoutMs,
      );

    if (verbose) {
      console.log(
        `      Fixed result: ${
          fixed.passed
            ? 'PASS'
            : 'FAIL'
        }`,
      );
    }

    /**
     * -----------------------------------------
     * CLASSIFICATION
     * -----------------------------------------
     */

    let status:
      ValidationStatus;

    let validationReason:
      string;

    if (
      !baseline.passed &&
      fixed.passed
    ) {
      status =
        'baseline-fails-fixed-passes';

      validationReason =
        'Candidate test files fail against the parent commit and pass against the historical fix commit.';
    } else if (
      baseline.passed &&
      fixed.passed
    ) {
      status =
        'validated-no-regression-test';

      validationReason =
        'Both baseline and historical fix pass the available test suite; no reproducible regression failure was observed.';
    } else if (
      baseline.passed &&
      !fixed.passed
    ) {
      status =
        'invalid';

      validationReason =
        'The historical fix commit fails the available test suite.';
    } else {
      status =
        'unvalidated';

      validationReason =
        'Both baseline and historical fix fail the available test suite, so the candidate cannot be established as a valid fix.';
    }

    return {
      repository,
      commitSha:
        candidate.sha,
      shortSha:
        candidate.shortSha,
      parentSha,

      status,
      validationReason,

      baseline,
      fixed,

      tests:
        candidate.testFiles || [],

      durationMs:
        Date.now() - startedAt,

      timestamp:
        new Date().toISOString(),

      workspacePath:
        keepWorkspace
          ? workspacePath
          : undefined,
    };
  } catch (
    error: unknown
  ) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      repository,
      commitSha:
        candidate.sha,
      shortSha:
        candidate.shortSha,
      parentSha,

      status: 'unvalidated',

      validationReason:
        `Validation could not be completed: ${message}`,

      baseline,
      fixed,

      tests:
        candidate.testFiles || [],

      durationMs:
        Date.now() - startedAt,

      timestamp:
        new Date().toISOString(),

      workspacePath:
        keepWorkspace
          ? workspacePath
          : undefined,

      error: message,
    };
  } finally {
    /**
     * Remove temporary workspace unless explicitly requested.
     */
    if (
      workspacePath &&
      !keepWorkspace
    ) {
      try {
        await fs.promises.rm(
          workspacePath,
          {
            recursive: true,
            force: true,
          },
        );
      } catch {
        /**
         * Cleanup failure should not change the validation result.
         */
      }
    }
  }
}

/**
 * Save a validation report to disk.
 */
export function saveValidationReport(
  report: ValidationReport,
): string {
  fs.mkdirSync(
    VALIDATION_REPORTS_DIR,
    {
      recursive: true,
    },
  );

  const repository =
    report.repository.replace(
      /[^a-zA-Z0-9._-]/g,
      '-',
    );

  const filename =
    `${repository}-${report.shortSha}.json`;

  const outputPath =
    path.join(
      VALIDATION_REPORTS_DIR,
      filename,
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      report,
      null,
      2,
    ),
    'utf8',
  );

  return outputPath;
}

/**
 * Format one or more validation reports.
 *
 * Accepting both a single report and an array preserves compatibility
 * with the existing generate-tasks.ts caller.
 */
export function formatValidationSummary(
  reports:
    | ValidationReport
    | ValidationReport[],
): string {
  const reportList =
    Array.isArray(reports)
      ? reports
      : [reports];

  if (
    reportList.length === 0
  ) {
    return 'No validation reports.';
  }

  const lines: string[] = [];

  lines.push(
    `Validation reports: ${reportList.length}`,
  );

  lines.push('');

  for (
    const report of reportList
  ) {
    const baselineStatus =
      report.baseline.passed
        ? 'PASS'
        : 'FAIL';

    const fixedStatus =
      report.fixed.passed
        ? 'PASS'
        : 'FAIL';

    const durationSeconds =
      (
        report.durationMs /
        1000
      ).toFixed(1);

    lines.push(
      `Repository: ${report.repository}`,
    );

    lines.push(
      `Commit: ${report.shortSha}`,
    );

    lines.push(
      `Parent: ${
        report.parentSha
          ? report.parentSha.slice(
              0,
              7,
            )
          : 'none'
      }`,
    );

    lines.push(
      `Status: ${report.status}`,
    );

    lines.push(
      `Baseline: ${baselineStatus}`,
    );

    lines.push(
      `Fixed: ${fixedStatus}`,
    );

    lines.push(
      `Duration: ${durationSeconds}s`,
    );

    lines.push(
      `Reason: ${report.validationReason}`,
    );

    lines.push('');
  }

  return lines.join('\n');
}