/**
 * Dataset Readiness Test Suite
 * Verifies transitions between ready, needs-review, and rejected states.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkTaskReadiness } from './readiness-check.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Dataset Readiness Test Suite');
  console.log('========================================\n');

  const tempDir = path.join(os.tmpdir(), `typebench-readiness-test-${Date.now().toString(36)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // 1. Test Case A: Valid Task Definition
  console.log('Test 1: Valid Task Definition...');
  const readyTaskDir = path.join(tempDir, 'valid-task-1');
  fs.mkdirSync(readyTaskDir, { recursive: true });

  fs.writeFileSync(
    path.join(readyTaskDir, 'task.json'),
    JSON.stringify({
      taskId: 'valid-task-1',
      repositoryUrl: 'https://github.com/example/repo',
      baseCommit: 'a1b2c3d4e5f6',
      testCommand: 'npm test',
      taskStatus: 'ready',
    }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(readyTaskDir, 'prompt.md'),
    '# Task: Fix Bug in Repo\nFix the reported type issue.\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(readyTaskDir, 'metadata.json'),
    JSON.stringify({ commitSha: 'a1b2c3d4e5f6', signals: ['fix-keyword'] }),
    'utf-8'
  );

  const readyResult = await checkTaskReadiness(readyTaskDir, { runSandbox: false });
  assert(readyResult.status === 'ready', `Expected 'ready', got '${readyResult.status}'`);
  assert(readyResult.checks.schemaValid === true, 'Schema should be valid');
  assert(readyResult.checks.baseCommitResolves === true, 'Base commit should resolve');
  assert(readyResult.checks.antiContamination === true, 'Anti-contamination should pass');
  console.log('  ✅ Passed (Status: ready)\n');

  // 2. Test Case B: Task with Contamination (prompt leaks base commit)
  console.log('Test 2: Contaminated Task (Prompt leaks base SHA)...');
  const contamTaskDir = path.join(tempDir, 'contam-task-2');
  fs.mkdirSync(contamTaskDir, { recursive: true });

  fs.writeFileSync(
    path.join(contamTaskDir, 'task.json'),
    JSON.stringify({
      taskId: 'contam-task-2',
      repositoryUrl: 'https://github.com/example/repo',
      baseCommit: 'abcdef1234567890',
      testCommand: 'npm test',
      taskStatus: 'ready',
    }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(contamTaskDir, 'prompt.md'),
    '# Leaked Prompt\nHere is the commit: abcdef1234567890\n',
    'utf-8'
  );

  const contamResult = await checkTaskReadiness(contamTaskDir, { runSandbox: false });
  assert(contamResult.status === 'rejected', `Expected 'rejected' due to contamination, got '${contamResult.status}'`);
  assert(contamResult.checks.antiContamination === false, 'Anti-contamination should fail');
  console.log('  ✅ Passed (Status: rejected due to contamination)\n');

  // 3. Test Case C: Broken / Missing Fields
  console.log('Test 3: Missing Required Fields...');
  const brokenTaskDir = path.join(tempDir, 'broken-task-3');
  fs.mkdirSync(brokenTaskDir, { recursive: true });

  fs.writeFileSync(
    path.join(brokenTaskDir, 'task.json'),
    JSON.stringify({
      taskId: 'broken-task-3',
      // missing repositoryUrl, baseCommit, testCommand
    }),
    'utf-8'
  );

  const brokenResult = await checkTaskReadiness(brokenTaskDir, { runSandbox: false });
  assert(brokenResult.status === 'rejected', `Expected 'rejected', got '${brokenResult.status}'`);
  assert(brokenResult.checks.schemaValid === false, 'Schema should be invalid');
  console.log('  ✅ Passed (Status: rejected due to missing fields)\n');

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('🎉 All Readiness Tests Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal readiness test error:', err);
  process.exit(1);
});
