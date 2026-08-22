/**
 * TypeBench Dataset Release & Tamper Detection Test Suite
 * Verifies that dataset freezing computes deterministic SHA-256 fingerprints
 * and that any modification to a task file triggers tamper detection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { freezeDataset, verifyReleaseCheckpoint } from './freeze.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('[TypeBench] Release Freezing & Tamper Test');
  console.log('========================================\n');

  const tempDir = path.join(os.tmpdir(), `typebench-freeze-test-${Date.now().toString(36)}`);
  const tempTasksDir = path.join(tempDir, 'tasks');
  const tempReleasesDir = path.join(tempDir, 'releases');
  const tempManifestPath = path.join(tempDir, 'manifest.json');

  const taskDir1 = path.join(tempTasksDir, 'fixture-task-1');
  const taskDir2 = path.join(tempTasksDir, 'fixture-task-2');
  fs.mkdirSync(taskDir1, { recursive: true });
  fs.mkdirSync(taskDir2, { recursive: true });
  fs.mkdirSync(tempReleasesDir, { recursive: true });

  // Task 1
  fs.writeFileSync(
    path.join(taskDir1, 'task.json'),
    JSON.stringify({ taskId: 'fixture-task-1', repository: 'repo1', baseCommit: 'commit1', testCommand: 'npm test' }),
    'utf-8'
  );
  fs.writeFileSync(path.join(taskDir1, 'prompt.md'), '# Task 1\nDo thing 1\n', 'utf-8');
  fs.writeFileSync(path.join(taskDir1, 'metadata.json'), JSON.stringify({ commitSha: 'commit1', signals: [] }), 'utf-8');

  // Task 2
  fs.writeFileSync(
    path.join(taskDir2, 'task.json'),
    JSON.stringify({ taskId: 'fixture-task-2', repository: 'repo2', baseCommit: 'commit2', testCommand: 'npm test' }),
    'utf-8'
  );
  fs.writeFileSync(path.join(taskDir2, 'prompt.md'), '# Task 2\nDo thing 2\n', 'utf-8');
  fs.writeFileSync(path.join(taskDir2, 'metadata.json'), JSON.stringify({ commitSha: 'commit2', signals: [] }), 'utf-8');

  // 1. Test Freezing
  console.log('Test 1: Freezing Dataset Release v0.0.1-test...');
  const checkpoint = freezeDataset('0.0.1-test', {
    tasksDir: tempTasksDir,
    releasesDir: tempReleasesDir,
    manifestPath: tempManifestPath,
  });

  assert(checkpoint.version === '0.0.1-test', 'Version should match');
  assert(checkpoint.totalTasks === 2, 'Total tasks should be 2');
  assert(checkpoint.datasetFingerprint.startsWith('sha256:'), 'Fingerprint must be SHA-256');
  console.log(`  ✅ Checkpoint Created (Fingerprint: ${checkpoint.datasetFingerprint.slice(0, 20)}...)\n`);

  // 2. Test Valid Verification
  console.log('Test 2: Verifying Untampered Release...');
  const verifyValid = verifyReleaseCheckpoint(path.join(tempReleasesDir, 'v0.0.1-test.json'), {
    tasksDir: tempTasksDir,
  });

  assert(verifyValid.valid === true, 'Untampered release must pass verification');
  assert(verifyValid.verifiedTasks === 2, 'All 2 tasks should be verified');
  assert(verifyValid.mismatchedTasks.length === 0, 'Zero mismatches expected');
  console.log('  ✅ Passed (100% integrity verified)\n');

  // 3. Test Tamper Detection (Modify 1 character in prompt.md)
  console.log('Test 3: Tampering with task file (modifying prompt.md)...');
  fs.appendFileSync(path.join(taskDir1, 'prompt.md'), '\nTAMPERED EXTRA BYTE\n', 'utf-8');

  const verifyTampered = verifyReleaseCheckpoint(path.join(tempReleasesDir, 'v0.0.1-test.json'), {
    tasksDir: tempTasksDir,
  });

  assert(verifyTampered.valid === false, 'Tampered release must FAIL verification');
  assert(verifyTampered.mismatchedTasks.length === 1, 'Should detect exactly 1 mismatched task');
  assert(verifyTampered.mismatchedTasks[0].taskId === 'fixture-task-1', 'Should identify fixture-task-1');
  assert(verifyTampered.mismatchedTasks[0].field === 'prompt.md', 'Should identify prompt.md as tampered');
  console.log('  ✅ Passed (Tamper detection caught modified prompt.md)\n');

  // Cleanup
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log('========================================');
  console.log('🎉 All Release Freeze & Tamper Tests Passed!');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal release test error:', err);
  process.exit(1);
});
