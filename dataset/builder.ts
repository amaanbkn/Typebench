/**
 * TypeBench Benchmark Dataset Builder & Manifest Compiler
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cloneRepository, getSeedRepos } from '../scripts/clone-repo.js';
import { discoverGitHistory } from '../scripts/git-history.js';
import { discoverCandidates } from '../scripts/candidate-discovery.js';
import { validateCandidate, saveValidationReport } from '../scripts/validate-candidate.js';
import { createBenchmarkTask, TaskMetadata } from '../scripts/create-task.js';
import { evaluateQuality, QualityCriteria } from './quality-filter.js';

export interface DatasetRepository {
  name: string;
  owner: string;
  url: string;
  category: string;
  taskCount: number;
}

export interface DatasetTaskEntry {
  taskId: string;
  repository: string;
  title: string;
  category: string;
  difficulty: string;
  packageManager: string;
  testCommand: string;
  taskStatus: string;
  baseCommit: string;
  changedFilesCount: number;
  signals: string[];
  createdAt: string;
}

export interface DatasetStatistics {
  totalTasks: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byDifficulty: Record<string, number>;
  byRepository: Record<string, number>;
}

export interface DatasetManifest {
  datasetVersion: string;
  name: string;
  description: string;
  createdAt: string;
  repositories: DatasetRepository[];
  tasks: DatasetTaskEntry[];
  statistics: DatasetStatistics;
}

export interface BuildDatasetOptions {
  historyDepth?: number;
  maxCandidatesPerRepo?: number;
  createTasks?: boolean;
  verbose?: boolean;
  qualityCriteria?: QualityCriteria;
  manifestPath?: string;
  tasksDir?: string;
}

/**
 * Scans the tasks/ directory and compiles dataset/manifest.json
 */
export function compileManifest(
  tasksDir = path.resolve(process.cwd(), 'tasks'),
  outputManifestPath = path.resolve(process.cwd(), 'dataset/manifest.json')
): DatasetManifest {
  const seedRepos = getSeedRepos();
  const repoMap = new Map(seedRepos.map((r) => [r.name, r]));

  const taskEntries: DatasetTaskEntry[] = [];
  const taskDirs = fs
    .readdirSync(tasksDir)
    .filter(
      (d) =>
        !d.startsWith('_') &&
        !d.startsWith('.') &&
        fs.statSync(path.join(tasksDir, d)).isDirectory() &&
        fs.existsSync(path.join(tasksDir, d, 'task.json'))
    );

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  const byRepo: Record<string, number> = {};

  for (const dirName of taskDirs) {
    const taskPath = path.join(tasksDir, dirName, 'task.json');
    const metaPath = path.join(tasksDir, dirName, 'metadata.json');

    try {
      const taskJson = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
      let metadataJson: Partial<TaskMetadata> = {};
      if (fs.existsSync(metaPath)) {
        metadataJson = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      }

      const repoName = taskJson.repository || dirName.split('-')[0];
      const category = taskJson.category || 'bug_fix';
      const difficulty = taskJson.difficulty || 'medium';
      const status = taskJson.taskStatus || 'ready';

      byStatus[status] = (byStatus[status] || 0) + 1;
      byCategory[category] = (byCategory[category] || 0) + 1;
      byDifficulty[difficulty] = (byDifficulty[difficulty] || 0) + 1;
      byRepo[repoName] = (byRepo[repoName] || 0) + 1;

      taskEntries.push({
        taskId: taskJson.taskId || dirName,
        repository: repoName,
        title: taskJson.title || 'Untitled Benchmark Task',
        category,
        difficulty,
        packageManager: taskJson.packageManager || 'npm',
        testCommand: taskJson.testCommand || 'npm test',
        taskStatus: status,
        baseCommit: taskJson.baseCommit || '',
        changedFilesCount:
          metadataJson.changedFiles?.length ||
          metadataJson.filesChanged?.length ||
          0,
        signals: metadataJson.signals || [],
        createdAt: taskJson.createdAt || new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[Manifest] Error reading task in ${dirName}:`, err);
    }
  }

  // Sort tasks deterministically by taskId
  taskEntries.sort((a, b) => a.taskId.localeCompare(b.taskId));

  const repoEntries: DatasetRepository[] = [];
  for (const [repoName, count] of Object.entries(byRepo)) {
    const seed = repoMap.get(repoName);
    repoEntries.push({
      name: repoName,
      owner: seed?.owner || repoName,
      url: seed?.url || `https://github.com/${repoName}`,
      category: seed?.category || 'General TypeScript',
      taskCount: count,
    });
  }

  const manifest: DatasetManifest = {
    datasetVersion: '0.1.0',
    name: 'TypeBench TypeScript Benchmark Dataset',
    description:
      'Curated real-world TypeScript engineering benchmark tasks evaluating AI coding agents on type safety, bug fixes, and feature implementations.',
    createdAt: new Date().toISOString(),
    repositories: repoEntries,
    tasks: taskEntries,
    statistics: {
      totalTasks: taskEntries.length,
      byStatus,
      byCategory,
      byDifficulty,
      byRepository: byRepo,
    },
  };

  fs.mkdirSync(path.dirname(outputManifestPath), { recursive: true });
  fs.writeFileSync(outputManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifest;
}

/**
 * Builds benchmark tasks across repositories and updates the manifest.
 */
export async function buildDataset(
  repoQueries: string[],
  options: BuildDatasetOptions = {}
): Promise<DatasetManifest> {
  const depth = options.historyDepth ?? 30;
  const maxPerRepo = options.maxCandidatesPerRepo ?? 5;
  const verbose = options.verbose ?? false;
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  const manifestPath = options.manifestPath ?? path.resolve(process.cwd(), 'dataset/manifest.json');

  console.log(`\n========================================`);
  console.log(`[TypeBench] Building Benchmark Dataset`);
  console.log(`========================================`);
  console.log(`Repositories : ${repoQueries.join(', ')}`);
  console.log(`History Depth: ${depth} commits`);
  console.log(`Limit/Repo   : ${maxPerRepo} candidates\n`);

  for (const repoQuery of repoQueries) {
    console.log(`----------------------------------------`);
    console.log(`[Repo] Processing ${repoQuery}...`);
    console.log(`----------------------------------------`);

    // 1. Clone
    const cloneResult = await cloneRepository(repoQuery, { depth });
    if (!cloneResult.success || !cloneResult.workspacePath) {
      console.warn(`[Repo] Skipping ${repoQuery} due to clone failure.`);
      continue;
    }

    // 2. Discover history
    const historyResult = await discoverGitHistory(cloneResult.workspacePath, {
      depth,
      verbose: false,
    });

    if (!historyResult.success || historyResult.commits.length === 0) {
      console.warn(`[Repo] No commits discovered for ${repoQuery}.`);
      continue;
    }

    // 3. Discover candidates
    const discovery = discoverCandidates(historyResult.commits, { verbose: false });
    console.log(`[Repo] Discovered ${discovery.candidates.length} candidates from ${historyResult.totalDiscovered} commits.`);

    // 4. Quality filter & Validation
    const candidateSubset = discovery.candidates.slice(0, maxPerRepo);

    for (let i = 0; i < candidateSubset.length; i++) {
      const candidate = candidateSubset[i];
      const quality = evaluateQuality(candidate, undefined, options.qualityCriteria);

      if (!quality.passed) {
        if (verbose) {
          console.log(`   [Filter] Candidate ${candidate.shortSha} rejected: ${quality.reasons.join('; ')}`);
        }
        continue;
      }

      console.log(`-> Validating candidate [${i + 1}/${candidateSubset.length}] ${candidate.shortSha}: "${candidate.message.split('\n')[0]}"`);

      const report = await validateCandidate(
        cloneResult.repoName,
        cloneResult.workspacePath,
        candidate,
        { verbose: false, timeoutMs: 30000 }
      );

      saveValidationReport(report);

      if (options.createTasks !== false && report.status !== 'invalid') {
        const taskResult = await createBenchmarkTask(candidate, report, {
          workspacePath: cloneResult.workspacePath,
          tasksDir,
        });

        if (taskResult.success) {
          console.log(`   ✅ Task Created: ${taskResult.taskId} (${taskResult.taskConfig.taskStatus})`);
        }
      }
    }
  }

  // Compile central manifest
  const manifest = compileManifest(tasksDir, manifestPath);
  console.log(`\n[TypeBench] Dataset manifest compiled at: ${manifestPath}`);
  console.log(`Total Tasks in Dataset: ${manifest.statistics.totalTasks}\n`);

  return manifest;
}
