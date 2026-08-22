/**
 * Evaluator Verification Fixture
 * Verifies that the evaluator independently determines PASS (solved) vs FAIL (failed)
 * on controlled ground truth fixtures without modifying real benchmark tasks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';
import { evaluateRun } from './evaluator.js';

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Evaluator Verification Test');
  console.log('========================================\n');

  const tempDir = path.join(os.tmpdir(), `typebench-fixture-${Date.now().toString(36)}`);
  const fixtureRepoPath = path.join(tempDir, 'repo');
  const fixtureTaskDir = path.resolve(process.cwd(), 'tasks/_fixture_calc');
  const runsDir = path.resolve(process.cwd(), 'results/runs');

  fs.mkdirSync(fixtureRepoPath, { recursive: true });
  fs.mkdirSync(fixtureTaskDir, { recursive: true });

  const git: SimpleGit = simpleGit(fixtureRepoPath);
  await git.init();
  await git.raw(['config', 'user.name', 'TypeBench Fixture']);
  await git.raw(['config', 'user.email', 'fixture@typebench.org']);

  // 1. Create broken baseline repository
  fs.writeFileSync(
    path.join(fixtureRepoPath, 'package.json'),
    JSON.stringify(
      {
        name: 'calc-fixture',
        version: '1.0.0',
        scripts: { test: 'node test.cjs' },
      },
      null,
      2
    ),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(fixtureRepoPath, 'calc.cjs'),
    'module.exports = { add: (a, b) => a - b };\n',
    'utf-8'
  );

  fs.writeFileSync(
    path.join(fixtureRepoPath, 'test.cjs'),
    `const { add } = require('./calc.cjs');
if (add(2, 3) !== 5) {
  console.error('Test Failed: expected 2 + 3 = 5, got ' + add(2, 3));
  process.exit(1);
}
console.log('Test Passed: 2 + 3 = 5');
`,
    'utf-8'
  );

  await git.add('.');
  await git.commit('Initial baseline with arithmetic bug');
  const baseCommit = (await git.raw(['rev-parse', 'HEAD'])).trim();

  // 2. Create fixture task definition
  const taskConfig = {
    taskId: '_fixture_calc',
    repository: '_fixture_calc',
    repositoryUrl: fixtureRepoPath,
    baseCommit,
    category: 'bug_fix',
    difficulty: 'easy',
    title: 'Fix Addition in Calc',
    description: 'Fix the add function to return the sum of two numbers.',
    packageManager: 'npm',
    testCommand: 'node test.cjs',
    taskStatus: 'ready',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(fixtureTaskDir, 'task.json'),
    JSON.stringify(taskConfig, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(fixtureTaskDir, 'prompt.md'),
    '# Task: Fix Addition in Calc\nEnsure `add(a, b)` returns `a + b`.\n',
    'utf-8'
  );

  // 3. Test Case A: Incorrect / Broken Patch (FAIL expected)
  const failRunId = `fixture_fail_${Date.now().toString(36)}`;
  const failRunDir = path.join(runsDir, failRunId);
  fs.mkdirSync(failRunDir, { recursive: true });

  const failPatch = `diff --git a/calc.cjs b/calc.cjs
index 0000000..1111111 100644
--- a/calc.cjs
+++ b/calc.cjs
@@ -1 +1 @@
-module.exports = { add: (a, b) => a - b };
+module.exports = { add: (a, b) => a * b };
`;

  fs.writeFileSync(
    path.join(failRunDir, 'result.json'),
    JSON.stringify(
      {
        runId: failRunId,
        taskId: '_fixture_calc',
        agentName: 'broken-agent',
        status: 'completed',
        exitCode: 0,
        durationMs: 1000,
        changedFiles: ['calc.cjs'],
        patch: failPatch,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(path.join(failRunDir, 'patch.diff'), failPatch, 'utf-8');

  console.log(`[Test 1] Evaluating incorrect patch (should FAIL)...`);
  const failEval = await evaluateRun(failRunDir, { verbose: false });
  console.log(`  Status       : ${failEval.status}`);
  console.log(`  Tests Passed : ${failEval.benchmarkTests.passed ? 'Yes' : 'No'}`);
  console.log(`  Expected     : failed | Actual: ${failEval.status}\n`);

  if (failEval.status !== 'failed') {
    console.error(`FAIL: Expected evaluation to be 'failed', but got '${failEval.status}'`);
    process.exit(1);
  }

  // 4. Test Case B: Correct Patch (SOLVED expected)
  const passRunId = `fixture_pass_${Date.now().toString(36)}`;
  const passRunDir = path.join(runsDir, passRunId);
  fs.mkdirSync(passRunDir, { recursive: true });

  const passPatch = `diff --git a/calc.cjs b/calc.cjs
index 0000000..1111111 100644
--- a/calc.cjs
+++ b/calc.cjs
@@ -1 +1 @@
-module.exports = { add: (a, b) => a - b };
+module.exports = { add: (a, b) => a + b };
`;

  fs.writeFileSync(
    path.join(passRunDir, 'result.json'),
    JSON.stringify(
      {
        runId: passRunId,
        taskId: '_fixture_calc',
        agentName: 'correct-agent',
        status: 'completed',
        exitCode: 0,
        durationMs: 1200,
        changedFiles: ['calc.cjs'],
        patch: passPatch,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(path.join(passRunDir, 'patch.diff'), passPatch, 'utf-8');

  console.log(`[Test 2] Evaluating correct patch (should be SOLVED)...`);
  const passEval = await evaluateRun(passRunDir, { verbose: false });
  console.log(`  Status       : ${passEval.status}`);
  console.log(`  Tests Passed : ${passEval.benchmarkTests.passed ? 'Yes' : 'No'}`);
  console.log(`  Expected     : solved | Actual: ${passEval.status}\n`);

  if (passEval.status !== 'solved') {
    console.error(`FAIL: Expected evaluation to be 'solved', but got '${passEval.status}'`);
    process.exit(1);
  }

  console.log('========================================');
  console.log('✅ Evaluator Verification Tests Passed!');
  console.log('  1. Incorrect implementation => FAILED');
  console.log('  2. Correct implementation   => SOLVED');
  console.log('========================================\n');

  // Clean up fixture task directory and temp repo
  try {
    fs.rmSync(fixtureTaskDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

main().catch((err) => {
  console.error('Fatal fixture test error:', err);
  process.exit(1);
});
