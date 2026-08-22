/**
 * Benchmark Execution Orchestrator Test Suite
 * Verifies end-to-end execution of a coding agent on a frozen dataset release checkpoint.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import { runBenchmarkOnRelease, formatBenchmarkReportSummary } from './benchmark-runner.js';
import { freezeDataset } from '../dataset/freeze.js';
import { registerAgent, getAgent } from '../agents/agent-runner.js';
import { AbstractCodingAgent, AgentContext, AgentResult } from '../agents/base-agent.js';

class BenchmarkSolverAgent extends AbstractCodingAgent {
  readonly name = 'test-benchmark-solver';

  async run(
    context: AgentContext
  ): Promise<Omit<AgentResult, 'runId' | 'taskId' | 'changedFiles' | 'patch' | 'timestamp'>> {
    const calcFile = path.join(context.workspacePath, 'calc.cjs');
    if (fs.existsSync(calcFile)) {
      fs.writeFileSync(calcFile, 'module.exports = { add: (a, b) => a + b };\n', 'utf-8');
    }
    return {
      agentName: this.name,
      status: 'completed',
      exitCode: 0,
      durationMs: 40,
      stdout: '[BenchmarkSolverAgent] Fixed calc.cjs',
      stderr: '',
      tokensUsed: 100,
    };
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Benchmark Orchestrator Test');
  console.log('========================================\n');

  registerAgent(new BenchmarkSolverAgent());
  assert(Boolean(getAgent('test-benchmark-solver')), 'Agent should be registered');

  const tempDir = path.join(os.tmpdir(), `typebench-bench-test-${Date.now().toString(36)}`);
  const fixtureRepoPath = path.join(tempDir, 'repo');
  const tempTasksDir = path.join(tempDir, 'tasks');
  const tempReleasesDir = path.join(tempDir, 'releases');
  const tempOutputDir = path.join(tempDir, 'benchmark-runs');
  const tempManifestPath = path.join(tempDir, 'manifest.json');

  const taskDir = path.join(tempTasksDir, 'fixture-calc-task');
  fs.mkdirSync(fixtureRepoPath, { recursive: true });
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(tempReleasesDir, { recursive: true });
  fs.mkdirSync(tempOutputDir, { recursive: true });

  const git: SimpleGit = simpleGit(fixtureRepoPath);
  await git.init();
  await git.raw(['config', 'user.name', 'TypeBench Test']);
  await git.raw(['config', 'user.email', 'test@typebench.org']);

  fs.writeFileSync(
    path.join(fixtureRepoPath, 'package.json'),
    JSON.stringify({ name: 'calc-fixture', version: '1.0.0', scripts: { test: 'node test.cjs' } }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(fixtureRepoPath, 'calc.cjs'), 'module.exports = { add: (a, b) => a - b };\n', 'utf-8');
  fs.writeFileSync(
    path.join(fixtureRepoPath, 'test.cjs'),
    `const { add } = require('./calc.cjs');
if (add(10, 20) !== 30) {
  console.error('Test Failed: expected 10 + 20 = 30, got ' + add(10, 20));
  process.exit(1);
}
console.log('Test Passed');
`,
    'utf-8'
  );

  await git.add('.');
  await git.commit('Broken baseline');
  const baseCommit = (await git.raw(['rev-parse', 'HEAD'])).trim();

  // Create Task Definition
  fs.writeFileSync(
    path.join(taskDir, 'task.json'),
    JSON.stringify({
      taskId: 'fixture-calc-task',
      repository: 'calc',
      repositoryUrl: fixtureRepoPath,
      baseCommit,
      category: 'bug_fix',
      difficulty: 'easy',
      title: 'Fix Arithmetic Calc',
      packageManager: 'npm',
      testCommand: 'node test.cjs',
      taskStatus: 'ready',
    }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(taskDir, 'prompt.md'), '# Fix Addition\nMake add return a + b\n', 'utf-8');
  fs.writeFileSync(
    path.join(taskDir, 'metadata.json'),
    JSON.stringify({ commitSha: baseCommit, signals: ['fix-keyword'] }, null, 2),
    'utf-8'
  );

  // Freeze Release Checkpoint
  const release = freezeDataset('0.0.1-exec', {
    tasksDir: tempTasksDir,
    releasesDir: tempReleasesDir,
    manifestPath: tempManifestPath,
  });

  const releasePath = path.join(tempReleasesDir, 'v0.0.1-exec.json');
  console.log(`[Test] Running benchmark on frozen release ${release.version}...`);

  const report = await runBenchmarkOnRelease(releasePath, 'test-benchmark-solver', {
    tasksDir: tempTasksDir,
    outputDir: tempOutputDir,
    verbose: false,
  });

  // Verify Report Assertions
  assert(report.totalTasks === 1, 'Total tasks should be 1');
  assert(report.evaluatedTasks === 1, 'Evaluated tasks should be 1');
  assert(report.solvedTasks === 1, 'Solved tasks should be 1');
  assert(report.passRate === 100, `Pass rate should be 100%, got ${report.passRate}%`);
  assert(report.meanScore === 100, `Mean score should be 100, got ${report.meanScore}`);

  const reportArtifact = path.join(tempOutputDir, `${report.benchmarkRunId}.json`);
  assert(fs.existsSync(reportArtifact), `Report artifact must exist at: ${reportArtifact}`);

  console.log(formatBenchmarkReportSummary(report));

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('✅ Benchmark Orchestrator Tests Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal benchmark test error:', err);
  process.exit(1);
});
