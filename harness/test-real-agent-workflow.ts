/**
 * Real-Agent Workflow End-to-End Test Suite
 * Validates real coding agent execution under Protocol v1.0.0,
 * verifying patch generation, independent evaluation, deterministic scoring,
 * and statistical validation artifact generation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import { validateRealAgentExecution, formatAgentValidationSummary } from './real-agent-validator.js';
import { freezeDataset } from '../dataset/freeze.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Real-Agent Workflow Test');
  console.log('========================================\n');

  const tempDir = path.join(os.tmpdir(), `typebench-real-agent-test-${Date.now().toString(36)}`);
  const fixtureRepoPath = path.join(tempDir, 'repo');
  const tempTasksDir = path.join(tempDir, 'tasks');
  const tempReleasesDir = path.join(tempDir, 'releases');
  const tempOutputDir = path.join(tempDir, 'agent-validations');
  const tempManifestPath = path.join(tempDir, 'manifest.json');

  const taskDir = path.join(tempTasksDir, 'fixture-real-calc-task');
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
    JSON.stringify({ name: 'real-agent-fixture', version: '1.0.0', scripts: { test: 'node test.cjs' } }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(fixtureRepoPath, 'calc.cjs'), 'module.exports = { add: (a, b) => a - b };\n', 'utf-8');
  fs.writeFileSync(
    path.join(fixtureRepoPath, 'test.cjs'),
    `const { add } = require('./calc.cjs');
if (add(7, 3) !== 10) {
  console.error('Test failed! Expected 7 + 3 = 10, got ' + add(7, 3));
  process.exit(1);
}
console.log('Arithmetic verification passed.');
`,
    'utf-8'
  );

  await git.add('.');
  await git.commit('Broken arithmetic baseline');
  const baseCommit = (await git.raw(['rev-parse', 'HEAD'])).trim();

  // Create Task Definition
  fs.writeFileSync(
    path.join(taskDir, 'task.json'),
    JSON.stringify({
      taskId: 'fixture-real-calc-task',
      repository: 'calc',
      repositoryUrl: fixtureRepoPath,
      baseCommit,
      category: 'bug_fix',
      difficulty: 'easy',
      title: 'Fix addition arithmetic bug in calc.cjs',
      packageManager: 'npm',
      testCommand: 'node test.cjs',
      taskStatus: 'ready',
    }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(taskDir, 'prompt.md'),
    '# Fix Addition Arithmetic\nIn calc.cjs, make add(a, b) return a + b instead of a - b.\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(taskDir, 'metadata.json'),
    JSON.stringify({ commitSha: baseCommit, signals: ['arithmetic-fix'] }, null, 2),
    'utf-8'
  );

  // Freeze release checkpoint
  const release = freezeDataset('0.0.1-real', {
    tasksDir: tempTasksDir,
    releasesDir: tempReleasesDir,
    manifestPath: tempManifestPath,
  });
  const releasePath = path.join(tempReleasesDir, 'v0.0.1-real.json');

  console.log(`[Test] Running real-agent validation for "ts-solver" on release ${release.version}...`);

  const report = await validateRealAgentExecution('ts-solver', releasePath, {
    trials: 2,
    tasksDir: tempTasksDir,
    outputDir: tempOutputDir,
    verbose: false,
  });

  // Assertions
  assert(report.isEndToEndValid === true, 'Report must be end-to-end valid');
  assert(report.passAt1 === 100, `Expected Pass@1 = 100%, got ${report.passAt1}%`);
  assert(report.meanScore === 100, `Expected Mean Score = 100, got ${report.meanScore}`);
  assert(report.consistencyRate === 100, `Expected Consistency Rate = 100%, got ${report.consistencyRate}%`);
  assert(report.flakyTasksCount === 0, `Expected 0 flaky tasks, got ${report.flakyTasksCount}`);

  const reportArtifact = path.join(tempOutputDir, `${report.validationId}.json`);
  assert(fs.existsSync(reportArtifact), `Report artifact must exist at: ${reportArtifact}`);

  console.log(formatAgentValidationSummary(report));

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('🎉 Real-Agent Workflow Test Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal real agent test error:', err);
  process.exit(1);
});
