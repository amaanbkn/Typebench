/**
 * TypeBench Dataset Freezing & Release Checkpoint Engine
 * Provides cryptographic SHA-256 fingerprinting for benchmark task packages,
 * ensuring immutable versioned checkpoints (e.g. TypeBench Dataset v0.1.0).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { compileManifest } from './builder.js';

export interface TaskChecksums {
  taskJson: string;
  promptMd: string;
  metadataJson: string;
  composite: string;
}

export interface ReleaseTaskEntry {
  taskId: string;
  repository: string;
  title: string;
  category: string;
  difficulty: string;
  packageManager: string;
  testCommand: string;
  taskStatus: string;
  baseCommit: string;
  checksums: TaskChecksums;
  createdAt: string;
}

export interface ReleaseRepositoryCheckpoint {
  name: string;
  owner: string;
  url: string;
  taskCount: number;
  baseCommits: string[];
}

export interface DatasetReleaseCheckpoint {
  version: string;
  datasetName: string;
  description: string;
  releaseDate: string;
  datasetFingerprint: string;
  totalTasks: number;
  repositories: ReleaseRepositoryCheckpoint[];
  tasks: ReleaseTaskEntry[];
  statistics: {
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    byDifficulty: Record<string, number>;
    byRepository: Record<string, number>;
  };
}

export interface FreezeOptions {
  tasksDir?: string;
  releasesDir?: string;
  manifestPath?: string;
  verbose?: boolean;
}

export interface ReleaseVerificationResult {
  valid: boolean;
  version: string;
  expectedFingerprint: string;
  computedFingerprint: string;
  totalTasks: number;
  verifiedTasks: number;
  mismatchedTasks: Array<{
    taskId: string;
    field: string;
    expected: string;
    actual: string;
  }>;
  errors: string[];
}

/**
 * Computes the SHA-256 hash of a file's contents.
 */
export function computeFileSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for checksum: ${filePath}`);
  }
  const content = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Computes cryptographic SHA-256 checksums for a task package directory.
 */
export function computeTaskChecksums(taskDir: string): TaskChecksums {
  const taskJsonPath = path.join(taskDir, 'task.json');
  const promptMdPath = path.join(taskDir, 'prompt.md');
  const metaJsonPath = path.join(taskDir, 'metadata.json');

  const taskJsonHash = computeFileSha256(taskJsonPath);
  const promptMdHash = computeFileSha256(promptMdPath);
  const metaJsonHash = computeFileSha256(metaJsonPath);

  const compositeHash = `sha256:${crypto
    .createHash('sha256')
    .update(`${taskJsonHash}:${promptMdHash}:${metaJsonHash}`)
    .digest('hex')}`;

  return {
    taskJson: taskJsonHash,
    promptMd: promptMdHash,
    metadataJson: metaJsonHash,
    composite: compositeHash,
  };
}

/**
 * Freezes the current tasks into an immutable, versioned release checkpoint.
 */
export function freezeDataset(
  version: string,
  options: FreezeOptions = {}
): DatasetReleaseCheckpoint {
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  const releasesDir = options.releasesDir ?? path.resolve(process.cwd(), 'dataset/releases');
  const manifestPath = options.manifestPath ?? path.resolve(process.cwd(), 'dataset/manifest.json');

  // Compile / synchronize live manifest first
  const liveManifest = compileManifest(tasksDir, manifestPath);

  const taskEntries: ReleaseTaskEntry[] = [];
  const repoCommitsMap: Record<string, Set<string>> = {};

  for (const t of liveManifest.tasks) {
    const taskDir = path.join(tasksDir, t.taskId);
    const checksums = computeTaskChecksums(taskDir);

    taskEntries.push({
      taskId: t.taskId,
      repository: t.repository,
      title: t.title,
      category: t.category,
      difficulty: t.difficulty,
      packageManager: t.packageManager,
      testCommand: t.testCommand,
      taskStatus: t.taskStatus,
      baseCommit: t.baseCommit,
      checksums,
      createdAt: t.createdAt,
    });

    if (!repoCommitsMap[t.repository]) {
      repoCommitsMap[t.repository] = new Set<string>();
    }
    if (t.baseCommit) {
      repoCommitsMap[t.repository].add(t.baseCommit);
    }
  }

  // Sort deterministically
  taskEntries.sort((a, b) => a.taskId.localeCompare(b.taskId));

  // Compute global dataset Merkle-style root fingerprint
  const fingerprintPayload = taskEntries
    .map((t) => `${t.taskId}:${t.baseCommit}:${t.checksums.composite}`)
    .join('|');

  const datasetFingerprint = `sha256:${crypto
    .createHash('sha256')
    .update(`v${version}|${fingerprintPayload}`)
    .digest('hex')}`;

  const repositories: ReleaseRepositoryCheckpoint[] = liveManifest.repositories.map((r) => ({
    name: r.name,
    owner: r.owner,
    url: r.url,
    taskCount: r.taskCount,
    baseCommits: Array.from(repoCommitsMap[r.name] || []).sort(),
  }));

  const checkpoint: DatasetReleaseCheckpoint = {
    version,
    datasetName: liveManifest.name,
    description: liveManifest.description,
    releaseDate: new Date().toISOString(),
    datasetFingerprint,
    totalTasks: taskEntries.length,
    repositories,
    tasks: taskEntries,
    statistics: liveManifest.statistics,
  };

  // Save immutable release checkpoint artifact
  fs.mkdirSync(releasesDir, { recursive: true });
  const releaseFilePath = path.join(releasesDir, `v${version}.json`);
  fs.writeFileSync(releaseFilePath, JSON.stringify(checkpoint, null, 2), 'utf-8');

  // Update live manifest with dataset fingerprint
  const updatedManifest = {
    ...liveManifest,
    datasetFingerprint,
    releaseVersion: version,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf-8');

  if (options.verbose) {
    console.log(`[DatasetFreeze] Release checkpoint saved to: ${releaseFilePath}`);
    console.log(`[DatasetFreeze] Dataset Fingerprint: ${datasetFingerprint}`);
  }

  return checkpoint;
}

/**
 * Validates an existing release checkpoint against the current workspace tasks.
 */
export function verifyReleaseCheckpoint(
  releasePathOrVersion: string,
  options: FreezeOptions = {}
): ReleaseVerificationResult {
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  let releasePath = path.resolve(process.cwd(), releasePathOrVersion);

  if (!fs.existsSync(releasePath)) {
    const candidate = path.resolve(process.cwd(), 'dataset/releases', `v${releasePathOrVersion}.json`);
    if (fs.existsSync(candidate)) {
      releasePath = candidate;
    } else {
      const candidateRaw = path.resolve(process.cwd(), 'dataset/releases', `${releasePathOrVersion}.json`);
      if (fs.existsSync(candidateRaw)) {
        releasePath = candidateRaw;
      }
    }
  }

  if (!fs.existsSync(releasePath)) {
    return {
      valid: false,
      version: 'unknown',
      expectedFingerprint: '',
      computedFingerprint: '',
      totalTasks: 0,
      verifiedTasks: 0,
      mismatchedTasks: [],
      errors: [`Release file not found at: ${releasePath}`],
    };
  }

  const checkpoint: DatasetReleaseCheckpoint = JSON.parse(fs.readFileSync(releasePath, 'utf-8'));
  const errors: string[] = [];
  const mismatchedTasks: ReleaseVerificationResult['mismatchedTasks'] = [];
  let verifiedCount = 0;

  const currentTaskChecksums: string[] = [];

  for (const expectedTask of checkpoint.tasks) {
    const taskDir = path.join(tasksDir, expectedTask.taskId);
    if (!fs.existsSync(taskDir)) {
      errors.push(`Task directory missing: ${taskDir}`);
      continue;
    }

    try {
      const actualChecksums = computeTaskChecksums(taskDir);

      let taskValid = true;
      if (actualChecksums.taskJson !== expectedTask.checksums.taskJson) {
        mismatchedTasks.push({
          taskId: expectedTask.taskId,
          field: 'task.json',
          expected: expectedTask.checksums.taskJson,
          actual: actualChecksums.taskJson,
        });
        taskValid = false;
      }

      if (actualChecksums.promptMd !== expectedTask.checksums.promptMd) {
        mismatchedTasks.push({
          taskId: expectedTask.taskId,
          field: 'prompt.md',
          expected: expectedTask.checksums.promptMd,
          actual: actualChecksums.promptMd,
        });
        taskValid = false;
      }

      if (actualChecksums.metadataJson !== expectedTask.checksums.metadataJson) {
        mismatchedTasks.push({
          taskId: expectedTask.taskId,
          field: 'metadata.json',
          expected: expectedTask.checksums.metadataJson,
          actual: actualChecksums.metadataJson,
        });
        taskValid = false;
      }

      if (taskValid) {
        verifiedCount++;
      }

      currentTaskChecksums.push(`${expectedTask.taskId}:${expectedTask.baseCommit}:${actualChecksums.composite}`);
    } catch (err: any) {
      errors.push(`Error computing checksum for ${expectedTask.taskId}: ${err.message || String(err)}`);
    }
  }

  // Recompute global fingerprint
  const computedFingerprintPayload = currentTaskChecksums.join('|');
  const computedFingerprint = `sha256:${crypto
    .createHash('sha256')
    .update(`v${checkpoint.version}|${computedFingerprintPayload}`)
    .digest('hex')}`;

  const valid =
    mismatchedTasks.length === 0 &&
    errors.length === 0 &&
    computedFingerprint === checkpoint.datasetFingerprint &&
    verifiedCount === checkpoint.totalTasks;

  return {
    valid,
    version: checkpoint.version,
    expectedFingerprint: checkpoint.datasetFingerprint,
    computedFingerprint,
    totalTasks: checkpoint.totalTasks,
    verifiedTasks: verifiedCount,
    mismatchedTasks,
    errors,
  };
}
