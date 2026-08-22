/**
 * Standardized Benchmark Protocol Test Suite
 * Validates protocol invariant enforcement, anti-contamination checks, and multi-agent execution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import {
  createDefaultProtocolConfig,
  validateProtocolInvariants,
  executeBenchmarkProtocol,
  formatProtocolReportSummary,
} from './protocol.js';
import { freezeDataset } from '../dataset/freeze.js';
import { registerAgent } from '../agents/agent-runner.js';
import { AbstractCodingAgent, AgentContext, AgentResult } from '../agents/base-agent.js';

class ProtocolSolverAgent extends AbstractCodingAgent {
  readonly name = 'test-protocol-solver';

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
      durationMs: 30,
      stdout: '[ProtocolSolverAgent] Fixed calc.cjs',
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
  console.log('[TypeBench] Standardized Protocol Tests');
  console.log('========================================\n');

  registerAgent(new ProtocolSolverAgent());

  // Setup test environment
  const tempDir = path.join(os.tmpdir(), `typebench-protocol-test-${Date.now().toString(36)}`);
  const fixtureRepoPath = path.join(tempDir, 'repo');
  const tempTasksDir = path.join(tempDir, 'tasks');
  const tempReleasesDir = path.join(tempDir, 'releases');
  const tempOutputDir = path.join(tempDir, 'protocol-runs');
  const tempManifestPath = path.join(tempDir, 'manifest.json');

  const taskDir = path.join(tempTasksDir, 'fixture-protocol-task');
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
    JSON.stringify({ name: 'protocol-fixture', version: '1.0.0', scripts: { test: 'node test.cjs' } }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(fixtureRepoPath, 'calc.cjs'), 'module.exports = { add: (a, b) => a - b };\n', 'utf-8');
  fs.writeFileSync(
    path.join(fixtureRepoPath, 'test.cjs'),
    `const { add } = require('./calc.cjs');
if (add(5, 5) !== 10) {
  process.exit(1);
}
`,
    'utf-8'
  );

  await git.add('.');
  await git.commit('Broken fixture');
  const baseCommit = (await git.raw(['rev-parse', 'HEAD'])).trim();

  fs.writeFileSync(
    path.join(taskDir, 'task.json'),
    JSON.stringify({
      taskId: 'fixture-protocol-task',
      repository: 'calc',
      repositoryUrl: fixtureRepoPath,
      baseCommit,
      category: 'bug_fix',
      difficulty: 'easy',
      title: 'Fix addition in calc.cjs',
      packageManager: 'npm',
      testCommand: 'node test.cjs',
      taskStatus: 'ready',
    }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(taskDir, 'prompt.md'), '# Fix Addition\nMake add return sum\n', 'utf-8');
  fs.writeFileSync(
    path.join(taskDir, 'metadata.json'),
    JSON.stringify({ commitSha: baseCommit, signals: ['fix-keyword'] }, null, 2),
    'utf-8'
  );

  // Freeze test release
  const release = freezeDataset('0.0.1-proto', {
    tasksDir: tempTasksDir,
    releasesDir: tempReleasesDir,
    manifestPath: tempManifestPath,
  });
  const releasePath = path.join(tempReleasesDir, 'v0.0.1-proto.json');

  // Test 1: Invariant check passes on valid config
  console.log('Test 1: Testing protocol invariant validation on valid release...');
  const validConfig = createDefaultProtocolConfig(releasePath, '0.0.1-proto');
  const check1 = validateProtocolInvariants(validConfig, { tasksDir: tempTasksDir });
  assert(check1.valid, `Valid protocol config should pass: ${check1.errors.join(', ')}`);
  console.log('  ✅ Invariant check passed.\n');

  // Test 2: Invariant check fails on mismatched fingerprint
  console.log('Test 2: Testing protocol invariant check on mismatched fingerprint...');
  const badFingerprintConfig = {
    ...validConfig,
    expectedFingerprint: 'sha256:invalidfingerprint1234567890',
  };
  const check2 = validateProtocolInvariants(badFingerprintConfig, { tasksDir: tempTasksDir });
  assert(!check2.valid, 'Mismatched fingerprint must fail validation');
  console.log('  ✅ Fingerprint mismatch caught.\n');

  // Test 3: Invariant check fails on invalid scoring weights
  console.log('Test 3: Testing protocol invariant check on invalid scoring weights...');
  const badWeightsConfig = {
    ...validConfig,
    scoringWeights: { benchmark: 0.5, typecheck: 0.1, regression: 0.1 },
  };
  const check3 = validateProtocolInvariants(badWeightsConfig, { tasksDir: tempTasksDir });
  assert(!check3.valid, 'Weights not summing to 1.0 must fail validation');
  console.log('  ✅ Invalid weights caught.\n');

  // Test 4: Multi-Agent Protocol Execution
  console.log('Test 4: Testing multi-agent execution under standardized protocol...');
  validConfig.trialsPerTask = 2;
  const protocolReport = await executeBenchmarkProtocol(
    validConfig,
    ['test-protocol-solver', 'mock'],
    {
      tasksDir: tempTasksDir,
      outputProtocolDir: tempOutputDir,
      verbose: false,
    }
  );

  assert(protocolReport.evaluatedAgents.length === 2, 'Should evaluate 2 agents');
  assert(protocolReport.agentSummaries['test-protocol-solver'].passAt1 === 100, 'Solver Pass@1 should be 100%');
  assert(protocolReport.agentSummaries['test-protocol-solver'].meanScore === 100, 'Solver Mean Score should be 100');
  assert(protocolReport.agentSummaries['mock'].passAt1 === 0, 'Mock Pass@1 should be 0%');
  assert(protocolReport.agentSummaries['mock'].meanScore === 0, 'Mock Mean Score should be 0');

  console.log(formatProtocolReportSummary(protocolReport));

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('🎉 All Protocol Invariant & Execution Tests Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal protocol test error:', err);
  process.exit(1);
});
