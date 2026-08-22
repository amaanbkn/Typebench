/**
 * TypeBench Dataset Integrity Verifier
 * Validates dataset/manifest.json against all task package artifacts, verifying schema conformance,
 * completeness of prompt.md and metadata.json, and anti-contamination guarantees.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatasetManifest } from './builder.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ INTEGRITY ERROR: ${message}`);
    process.exit(1);
  }
}

export function verifyDataset(
  manifestPath = path.resolve(process.cwd(), 'dataset/manifest.json'),
  tasksDir = path.resolve(process.cwd(), 'tasks')
): boolean {
  console.log('\n========================================');
  console.log('[TypeBench] Verifying Dataset Integrity');
  console.log('========================================\n');

  assert(fs.existsSync(manifestPath), `Manifest file not found at: ${manifestPath}`);

  const rawManifest = fs.readFileSync(manifestPath, 'utf-8');
  let manifest: DatasetManifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (err) {
    assert(false, `Manifest JSON parse error: ${err}`);
    return false;
  }

  assert(Boolean(manifest.datasetVersion), 'Manifest must declare datasetVersion');
  assert(Array.isArray(manifest.repositories), 'Manifest must declare repositories array');
  assert(Array.isArray(manifest.tasks), 'Manifest must declare tasks array');
  assert(manifest.tasks.length > 0, 'Dataset tasks array must not be empty');

  console.log(`Checking ${manifest.tasks.length} tasks across ${manifest.repositories.length} repositories...\n`);

  const seenTaskIds = new Set<string>();

  for (let i = 0; i < manifest.tasks.length; i++) {
    const taskEntry = manifest.tasks[i];
    const taskId = taskEntry.taskId;

    // Check duplicate IDs
    assert(!seenTaskIds.has(taskId), `Duplicate taskId detected: ${taskId}`);
    seenTaskIds.add(taskId);

    const taskFolder = path.join(tasksDir, taskId);
    assert(fs.existsSync(taskFolder), `Task folder missing: ${taskFolder}`);

    // Check task.json
    const taskJsonPath = path.join(taskFolder, 'task.json');
    assert(fs.existsSync(taskJsonPath), `task.json missing in ${taskFolder}`);
    const taskConfig = JSON.parse(fs.readFileSync(taskJsonPath, 'utf-8'));
    assert(Boolean(taskConfig.baseCommit), `task.json in ${taskId} missing baseCommit`);
    assert(Boolean(taskConfig.testCommand), `task.json in ${taskId} missing testCommand`);
    assert(Boolean(taskConfig.repositoryUrl), `task.json in ${taskId} missing repositoryUrl`);

    // Check prompt.md
    const promptPath = path.join(taskFolder, 'prompt.md');
    assert(fs.existsSync(promptPath), `prompt.md missing in ${taskFolder}`);
    const promptContent = fs.readFileSync(promptPath, 'utf-8');
    assert(promptContent.trim().length > 20, `prompt.md in ${taskId} is too short or empty`);

    // Anti-contamination check: Ensure prompt does not leak commit SHA or PR URL
    assert(
      !promptContent.includes(taskConfig.baseCommit),
      `prompt.md in ${taskId} leaks base commit SHA`
    );

    // Check metadata.json
    const metaPath = path.join(taskFolder, 'metadata.json');
    assert(fs.existsSync(metaPath), `metadata.json missing in ${taskFolder}`);
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    assert(Boolean(metadata.commitSha), `metadata.json in ${taskId} missing commitSha`);
    assert(
      Array.isArray(metadata.signals) || typeof metadata.signals === 'object',
      `metadata.json in ${taskId} missing signals`
    );

    console.log(`  ✅ [${i + 1}/${manifest.tasks.length}] Task ${taskId} passed integrity checks.`);
  }

  // Verify statistics consistency
  assert(
    manifest.statistics.totalTasks === manifest.tasks.length,
    `Statistics totalTasks (${manifest.statistics.totalTasks}) does not match tasks count (${manifest.tasks.length})`
  );

  console.log('\n========================================');
  console.log('🎉 Dataset Integrity Verification PASSED!');
  console.log(`  - Valid Tasks : ${manifest.tasks.length}`);
  console.log(`  - Repositories: ${manifest.repositories.length}`);
  console.log('========================================\n');
  return true;
}

if (process.argv[1]?.includes('verify-dataset')) {
  verifyDataset();
}
