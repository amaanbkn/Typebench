/**
 * TypeBench Candidate Validation Utility
 * Verifies whether historical candidate commits exhibit reproducible fail-to-pass or passing test behaviors in isolated workspaces.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit, SimpleGit } from 'simple-git';
import { CandidateCommit } from './candidate-discovery.js';

const execAsync = promisify(exec);

export type ValidationStatus =
  | 'baseline-fails-fixed-passes'
  | 'validated-no-regression-test'
  | 'unvalidated'
  | 'invalid';

export interface TestExecutionResult {
  command: string;
  exitCode: number;
  durationMs: number;
  passed: boolean;
  status: 'passed' | 'failed' | 'timeout' | 'error' | 'skipped';
  stdoutSnippet: string;
  stderrSnippet: string;
  isEnvironmentFailure?: boolean;
}

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

export interface ValidationOptions {
  timeoutMs?: number;
  installDependencies?: boolean;
  verbose?: boolean;
  keepWorkspace?: boolean;
  tempDir?: string;
}

/**
 * Detects the package manager and optimal test command for a repository.
 */
export function detectTestCommand(
  workspacePath: string,
  testFiles: string[] = []
): {
  packageManager: 'npm' | 'pnpm' | 'yarn';
  testCommand: string;
  targetedCommand?: string;
} {
  let packageManager: 'npm' | 'pnpm' | 'yarn' = 'npm';
  if (
    fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml')) ||
    fs.existsSync(path.join(workspacePath, 'pnpm-workspace.yaml'))
  ) {
    packageManager = 'pnpm';
  } else if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) {
    packageManager = 'yarn';
  }

  let testCommand = `${packageManager} test`;
  let targetedCommand: string | undefined;

  const pkgJsonPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      if (pkg.scripts && pkg.scripts.test) {
        testCommand = `${packageManager} test`;
      }
    } catch {
      // fallback to npm test
    }
  }

  // If specific test files are present, formulate targeted test command if feasible
  if (testFiles.length > 0) {
    // Prioritize unit/spec test files over bundle-size/benchmark tests
    const sortedTests = [...testFiles].sort((a, b) => {
      const aScore = a.includes('/tests/') || a.includes('.spec.') ? 1 : 0;
      const bScore = b.includes('/tests/') || b.includes('.spec.') ? 1 : 0;
      return bScore - aScore;
    });

    const primaryTest = sortedTests[0];
    if (packageManager === 'pnpm') {
      targetedCommand = `pnpm test -- ${primaryTest}`;
    } else if (packageManager === 'yarn') {
      targetedCommand = `yarn test ${primaryTest}`;
    } else {
      targetedCommand = `npm test -- ${primaryTest}`;
    }
  }

  return {
    packageManager,
    testCommand,
    targetedCommand,
  };
}

/**
 * Checks if output indicates an environmental or infrastructure failure rather than a code test failure.
 */
function isEnvironmentError(stderr: string, stdout: string, exitCode: number): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  if (
    combined.includes('command not found') ||
    combined.includes('node_modules missing') ||
    combined.includes('did you mean to install') ||
    combined.includes('cannot find module') ||
    combined.includes('module_not_found') ||
    combined.includes('enoent') ||
    combined.includes('unsupported engine') ||
    combined.includes('startup error') ||
    combined.includes('failed to initialize projects') ||
    combined.includes('failed to load config') ||
    combined.includes('err_pn_no_matching_version') ||
    combined.includes('econnrefused') ||
    combined.includes('network is unreachable') ||
    combined.includes('enotfound')
  ) {
    return true;
  }
  return false;
}

/**
 * Ensures dependencies are installed in the workspace if required.
 */
async function ensureDependencies(
  workspacePath: string,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  timeoutMs = 90000,
  verbose = false
): Promise<{ success: boolean; error?: string }> {
  const nodeModulesPath = path.join(workspacePath, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    return { success: true };
  }

  if (verbose) {
    console.log(`  [Validator] Installing dependencies with ${packageManager}...`);
  }

  const env = {
    ...process.env,
    PATH: `/home/shaktimaan/.local/bin:${process.env.PATH}`,
    CI: 'true',
  };

  let installCmd = `${packageManager} install`;
  if (packageManager === 'pnpm') {
    installCmd = `pnpm install --no-frozen-lockfile --ignore-scripts`;
  } else if (packageManager === 'npm') {
    installCmd = `npm install --no-audit --no-fund`;
  }

  try {
    await execAsync(installCmd, {
      cwd: workspacePath,
      timeout: timeoutMs,
      env,
    });
    return { success: true };
  } catch (err: any) {
    const errMsg = (err.stderr || err.stdout || err.message || '').trim().slice(0, 500);
    return {
      success: false,
      error: `Dependency installation failed: ${errMsg}`,
    };
  }
}

/**
 * Executes a test command within a workspace with timeout and stdout/stderr capture.
 */
async function runTestCommand(
  workspacePath: string,
  command: string,
  timeoutMs = 60000
): Promise<TestExecutionResult> {
  const startTime = Date.now();
  const env = {
    ...process.env,
    PATH: `/home/shaktimaan/.local/bin:${process.env.PATH}`,
    CI: 'true',
    NODE_ENV: 'test',
  };

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workspacePath,
      timeout: timeoutMs,
      env,
    });

    const durationMs = Date.now() - startTime;
    return {
      command,
      exitCode: 0,
      durationMs,
      passed: true,
      status: 'passed',
      stdoutSnippet: (stdout || '').trim().slice(0, 1000),
      stderrSnippet: (stderr || '').trim().slice(0, 1000),
      isEnvironmentFailure: false,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err.killed && err.signal === 'SIGTERM';
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    const stdoutSnippet = (err.stdout || '').trim().slice(0, 1000);
    const stderrSnippet = (err.stderr || err.message || '').trim().slice(0, 1000);

    const isEnvFailure = isEnvironmentError(stderrSnippet, stdoutSnippet, exitCode);

    return {
      command,
      exitCode,
      durationMs,
      passed: false,
      status: isTimeout ? 'timeout' : isEnvFailure ? 'error' : 'failed',
      stdoutSnippet,
      stderrSnippet,
      isEnvironmentFailure: isEnvFailure,
    };
  }
}

/**
 * Creates an empty test execution result placeholder.
 */
function createSkippedResult(command = 'none', status: 'skipped' | 'error' = 'skipped', error = ''): TestExecutionResult {
  return {
    command,
    exitCode: -1,
    durationMs: 0,
    passed: false,
    status,
    stdoutSnippet: '',
    stderrSnippet: error,
  };
}

/**
 * Validates a single candidate commit in an isolated workspace.
 */
export async function validateCandidate(
  repoName: string,
  sourceWorkspacePath: string,
  candidate: CandidateCommit,
  options: ValidationOptions = {}
): Promise<ValidationReport> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 60000;
  const shouldInstallDeps = options.installDependencies ?? true;
  const baseTempDir = options.tempDir ?? path.join(os.tmpdir(), 'typebench-validation');
  const validationWorkspacePath = path.join(
    baseTempDir,
    `${repoName}-${candidate.shortSha}-${Date.now().toString(36)}`
  );

  fs.mkdirSync(baseTempDir, { recursive: true });

  const defaultReport: ValidationReport = {
    repository: repoName,
    commitSha: candidate.sha,
    shortSha: candidate.shortSha,
    parentSha: candidate.parentSha,
    status: 'unvalidated',
    validationReason: 'Validation not completed',
    baseline: createSkippedResult(),
    fixed: createSkippedResult(),
    tests: candidate.testFiles || [],
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };

  // 1. Check parent SHA availability
  if (!candidate.parentSha) {
    defaultReport.status = 'unvalidated';
    defaultReport.validationReason = 'Commit has no parent SHA (root or shallow boundary commit).';
    defaultReport.durationMs = Date.now() - startTime;
    return defaultReport;
  }

  let git: SimpleGit;

  try {
    // 2. Create isolated validation workspace cloned from local source repo
    if (options.verbose) {
      console.log(`  [Validator] Creating isolated validation workspace for ${candidate.shortSha}...`);
    }

    const sourceGit = simpleGit(sourceWorkspacePath);
    await sourceGit.clone(sourceWorkspacePath, validationWorkspacePath);

    git = simpleGit(validationWorkspacePath);

    // 3. Checkout parent commit (Baseline)
    if (options.verbose) {
      console.log(`  [Validator] Checking out baseline parent commit: ${candidate.parentSha.slice(0, 7)}...`);
    }

    try {
      await git.checkout(candidate.parentSha);
      const headSha = (await git.raw(['rev-parse', 'HEAD'])).trim();
      if (!headSha.startsWith(candidate.parentSha.slice(0, 7))) {
        throw new Error(`Checked out commit ${headSha} does not match expected parent ${candidate.parentSha}`);
      }
    } catch (err: any) {
      defaultReport.status = 'unvalidated';
      defaultReport.validationReason = `Parent commit ${candidate.parentSha.slice(0, 7)} unavailable in shallow history: ${err.message || String(err)}`;
      defaultReport.durationMs = Date.now() - startTime;
      return defaultReport;
    }

    // 4. Detect test command
    const testConfig = detectTestCommand(validationWorkspacePath, candidate.testFiles);
    const testCmd = testConfig.targetedCommand || testConfig.testCommand;

    if (options.verbose) {
      console.log(`  [Validator] Detected test runner command: "${testCmd}"`);
    }

    // 5. Optionally ensure dependencies if requested
    if (shouldInstallDeps) {
      const depResult = await ensureDependencies(
        validationWorkspacePath,
        testConfig.packageManager,
        timeoutMs,
        options.verbose
      );
      if (!depResult.success) {
        // If installation failed, we still attempt running test command, but flag if test fails due to environment
        if (options.verbose) {
          console.warn(`  [Validator] Warning during dependency setup: ${depResult.error}`);
        }
      }
    }

    // 6. Run baseline test on parent commit
    if (options.verbose) {
      console.log(`  [Validator] Running baseline tests on pre-fix parent...`);
    }

    const baselineResult = await runTestCommand(validationWorkspacePath, testCmd, timeoutMs);
    defaultReport.baseline = baselineResult;

    // Check if baseline failed because of environment
    if (baselineResult.isEnvironmentFailure) {
      defaultReport.status = 'unvalidated';
      defaultReport.validationReason = `Environment failure during baseline test execution: ${baselineResult.stderrSnippet || baselineResult.stdoutSnippet}`;
      defaultReport.durationMs = Date.now() - startTime;
      return defaultReport;
    }

    // 7. Checkout historical fix (Candidate commit)
    if (options.verbose) {
      console.log(`  [Validator] Checking out fix commit: ${candidate.shortSha}...`);
    }

    try {
      await git.checkout(candidate.sha);
      const headSha = (await git.raw(['rev-parse', 'HEAD'])).trim();
      if (!headSha.startsWith(candidate.shortSha)) {
        throw new Error(`Checked out commit ${headSha} does not match candidate ${candidate.sha}`);
      }
    } catch (err: any) {
      defaultReport.status = 'unvalidated';
      defaultReport.validationReason = `Failed to checkout candidate commit ${candidate.shortSha}: ${err.message || String(err)}`;
      defaultReport.durationMs = Date.now() - startTime;
      return defaultReport;
    }

    // 8. Run fixed test on candidate commit
    if (options.verbose) {
      console.log(`  [Validator] Running tests on fixed candidate commit...`);
    }

    const fixedResult = await runTestCommand(validationWorkspacePath, testCmd, timeoutMs);
    defaultReport.fixed = fixedResult;

    // Check if fixed failed because of environment
    if (fixedResult.isEnvironmentFailure) {
      defaultReport.status = 'unvalidated';
      defaultReport.validationReason = `Environment failure during fixed test execution: ${fixedResult.stderrSnippet || fixedResult.stdoutSnippet}`;
      defaultReport.durationMs = Date.now() - startTime;
      return defaultReport;
    }

    // 9. Analyze and classify validation outcome
    if (!baselineResult.passed && fixedResult.passed) {
      defaultReport.status = 'baseline-fails-fixed-passes';
      defaultReport.validationReason =
        'Baseline failed on parent commit and fix commit successfully passed tests (Reproducible Fail-to-Pass Fix).';
    } else if (baselineResult.passed && fixedResult.passed) {
      defaultReport.status = 'validated-no-regression-test';
      defaultReport.validationReason =
        'Both baseline and fix commit passed tests (Valid feature addition or unmanifested baseline regression).';
    } else if (!fixedResult.passed && baselineResult.passed) {
      defaultReport.status = 'invalid';
      defaultReport.validationReason =
        'Candidate fix commit broke previously passing tests.';
    } else {
      defaultReport.status = 'invalid';
      defaultReport.validationReason =
        `Tests failed on both parent (exit ${baselineResult.exitCode}) and candidate (exit ${fixedResult.exitCode}) commits.`;
    }

    defaultReport.durationMs = Date.now() - startTime;
    return defaultReport;
  } catch (err: any) {
    defaultReport.status = 'unvalidated';
    defaultReport.validationReason = `Environment error during validation: ${err.message || String(err)}`;
    defaultReport.durationMs = Date.now() - startTime;
    return defaultReport;
  } finally {
    // 10. Clean up isolated validation workspace unless explicitly preserved
    if (!options.keepWorkspace && fs.existsSync(validationWorkspacePath)) {
      try {
        fs.rmSync(validationWorkspacePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

/**
 * Saves a validation report to results/validation/<repository>/<commit-sha>.json
 */
export function saveValidationReport(report: ValidationReport, baseDir = path.resolve(process.cwd(), 'results/validation')): string {
  const repoDir = path.join(baseDir, report.repository);
  fs.mkdirSync(repoDir, { recursive: true });

  const filePath = path.join(repoDir, `${report.shortSha}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

/**
 * Formats a validation summary table and details.
 */
export function formatValidationSummary(reports: ValidationReport[]): string {
  const total = reports.length;
  const failToPass = reports.filter((r) => r.status === 'baseline-fails-fixed-passes').length;
  const noRegression = reports.filter((r) => r.status === 'validated-no-regression-test').length;
  const unvalidated = reports.filter((r) => r.status === 'unvalidated').length;
  const invalid = reports.filter((r) => r.status === 'invalid').length;

  const shallowCount = reports.filter(
    (r) => r.status === 'unvalidated' && r.validationReason.toLowerCase().includes('shallow')
  ).length;
  const envCount = unvalidated - shallowCount;

  const lines: string[] = [];
  lines.push('\n========================================');
  lines.push('[TypeBench] Validation Summary');
  lines.push('========================================\n');
  lines.push(`Candidates evaluated : ${total}`);
  lines.push(`\nValidated:`);
  lines.push(`  baseline-fails-fixed-passes  : ${failToPass}`);
  lines.push(`  validated-no-regression-test : ${noRegression}`);
  lines.push(`\nUnvalidated:`);
  lines.push(`  shallow-history              : ${shallowCount}`);
  lines.push(`  environment-failure          : ${envCount}`);
  lines.push(`\nInvalid:`);
  lines.push(`  failed-tests                 : ${invalid}\n`);

  if (reports.length > 0) {
    lines.push('Validation Details:\n');
    reports.forEach((r, i) => {
      const icon =
        r.status === 'baseline-fails-fixed-passes'
          ? '🌟 [REPRODUCIBLE FIX]'
          : r.status === 'validated-no-regression-test'
          ? '✅ [VALIDATED]'
          : r.status === 'unvalidated'
          ? '⏳ [UNVALIDATED]'
          : '❌ [INVALID]';

      lines.push(`${i + 1}. ${r.shortSha} - ${icon} (${r.status})`);
      lines.push(`   Parent: ${r.parentSha ? r.parentSha.slice(0, 7) : 'none'}`);
      lines.push(`   Baseline: ${r.baseline.status} (exit ${r.baseline.exitCode}) | Fixed: ${r.fixed.status} (exit ${r.fixed.exitCode})`);
      lines.push(`   Reason: ${r.validationReason}`);
      lines.push(`   Duration: ${(r.durationMs / 1000).toFixed(2)}s\n`);
    });
  }

  return lines.join('\n');
}
