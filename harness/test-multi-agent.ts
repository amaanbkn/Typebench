/**
 * Multi-Agent Session Verification Test
 * Verifies multi-agent benchmark execution, score matrix calculation, and session report formatting.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import { runBenchmarkSession, formatComparisonSummary } from './session-runner.js';
import { registerAgent, getAgent } from '../agents/agent-runner.js';
import { AbstractCodingAgent, AgentContext, AgentResult } from '../agents/base-agent.js';

// Custom test agent that correctly solves the arithmetic fixture
class PerfectMockAgent extends AbstractCodingAgent {
  readonly name = 'test-perfect-agent';

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
      durationMs: 50,
      stdout: '[PerfectMockAgent] Fixed arithmetic logic in calc.cjs',
      stderr: '',
      tokensUsed: 120,
    };
  }
}

// Custom test agent that makes no changes (no-op)
class NoopMockAgent extends AbstractCodingAgent {
  readonly name = 'test-noop-agent';

  async run(
    _context: AgentContext
  ): Promise<Omit<AgentResult, 'runId' | 'taskId' | 'changedFiles' | 'patch' | 'timestamp'>> {
    return {
      agentName: this.name,
      status: 'completed',
      exitCode: 0,
      durationMs: 20,
      stdout: '[NoopMockAgent] Performed no changes.',
      stderr: '',
      tokensUsed: 10,
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
  console.log('[TypeBench] Multi-Agent Session Verification');
  console.log('========================================\n');

  // Register custom test agents
  registerAgent(new PerfectMockAgent());
  registerAgent(new NoopMockAgent());

  assert(Boolean(getAgent('test-perfect-agent')), 'PerfectMockAgent should be registered');
  assert(Boolean(getAgent('test-noop-agent')), 'NoopMockAgent should be registered');

  // Create temporary fixture repository
  const tempDir = path.join(os.tmpdir(), `typebench-multiagent-fixture-${Date.now().toString(36)}`);
  const fixtureRepoPath = path.join(tempDir, 'repo');
  const fixtureTaskDir = path.resolve(process.cwd(), 'tasks/_fixture_multiagent');

  fs.mkdirSync(fixtureRepoPath, { recursive: true });
  fs.mkdirSync(fixtureTaskDir, { recursive: true });

  const git: SimpleGit = simpleGit(fixtureRepoPath);
  await git.init();
  await git.raw(['config', 'user.name', 'TypeBench MultiAgent Test']);
  await git.raw(['config', 'user.email', 'multiagent@typebench.org']);

  fs.writeFileSync(
    path.join(fixtureRepoPath, 'package.json'),
    JSON.stringify({ name: 'calc-fixture', version: '1.0.0', scripts: { test: 'node test.cjs' } }, null, 2),
    'utf-8'
  );

  fs.writeFileSync(path.join(fixtureRepoPath, 'calc.cjs'), 'module.exports = { add: (a, b) => a - b };\n', 'utf-8');

  fs.writeFileSync(
    path.join(fixtureRepoPath, 'test.cjs'),
    `const { add } = require('./calc.cjs');
if (add(5, 7) !== 12) {
  console.error('Test Failed: expected 5 + 7 = 12, got ' + add(5, 7));
  process.exit(1);
}
console.log('Test Passed: 5 + 7 = 12');
`,
    'utf-8'
  );

  await git.add('.');
  await git.commit('Initial broken baseline');
  const baseCommit = (await git.raw(['rev-parse', 'HEAD'])).trim();

  // Create fixture task package
  const taskConfig = {
    taskId: '_fixture_multiagent',
    repository: '_fixture_multiagent',
    repositoryUrl: fixtureRepoPath,
    baseCommit,
    category: 'bug_fix',
    difficulty: 'easy',
    title: 'Fix MultiAgent Addition Calc',
    description: 'Fix add function to compute sum of numbers.',
    packageManager: 'npm',
    testCommand: 'node test.cjs',
    taskStatus: 'ready',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(fixtureTaskDir, 'task.json'), JSON.stringify(taskConfig, null, 2), 'utf-8');
  fs.writeFileSync(path.join(fixtureTaskDir, 'prompt.md'), '# Task: Fix Addition in Calc\n', 'utf-8');

  const testSessionId = `test_session_${Date.now().toString(36)}`;

  console.log(`[Test] Running benchmark session on fixture with 2 agents...`);
  const sessionResult = await runBenchmarkSession(
    [fixtureTaskDir],
    ['test-perfect-agent', 'test-noop-agent'],
    {
      sessionId: testSessionId,
      verbose: false,
    }
  );

  // Assertions
  console.log('\n[Test] Verifying session comparison stats...');
  const perfectStats = sessionResult.agents['test-perfect-agent'];
  const noopStats = sessionResult.agents['test-noop-agent'];

  assert(perfectStats.totalTasks === 1, 'Perfect agent total tasks should be 1');
  assert(perfectStats.solvedTasks === 1, 'Perfect agent solved tasks should be 1');
  assert(perfectStats.passRate === 100, `Perfect agent pass rate should be 100%, got ${perfectStats.passRate}%`);
  assert(perfectStats.meanScore === 100, `Perfect agent mean score should be 100, got ${perfectStats.meanScore}`);

  assert(noopStats.totalTasks === 1, 'Noop agent total tasks should be 1');
  assert(noopStats.solvedTasks === 0, 'Noop agent solved tasks should be 0');
  assert(noopStats.passRate === 0, `Noop agent pass rate should be 0%, got ${noopStats.passRate}%`);
  assert(noopStats.meanScore === 0, `Noop agent mean score should be 0, got ${noopStats.meanScore}`);

  // Verify session report artifact
  const sessionFile = path.resolve(process.cwd(), 'results/comparisons', `${testSessionId}.json`);
  assert(fs.existsSync(sessionFile), `Session report file should exist at: ${sessionFile}`);

  console.log('\nFormatted Summary Table:');
  console.log(formatComparisonSummary(sessionResult));

  // Cleanup
  try {
    fs.rmSync(fixtureTaskDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('✅ Multi-Agent Verification Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal multi-agent test error:', err);
  process.exit(1);
});
