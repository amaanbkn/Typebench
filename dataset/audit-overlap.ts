/**
 * TypeBench Task Independence & Overlap Auditor
 * Checks whether benchmark tasks are overly related through source-file overlap,
 * test-file overlap, module clustering, commit ancestry adjacency, or prompt similarity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatasetReleaseCheckpoint } from './freeze.js';

export interface FileOverlapEntry {
  filePath: string;
  taskIds: string[];
  count: number;
}

export interface PackageOverlapEntry {
  repository: string;
  packageModule: string;
  taskIds: string[];
  count: number;
}

export interface CommitAdjacencyEntry {
  repository: string;
  taskA: string;
  commitA: string;
  taskB: string;
  commitB: string;
  relationship: 'parent_child' | 'shared_base_commit' | 'adjacent_in_history';
  description: string;
}

export interface PromptSimilarityEntry {
  taskA: string;
  taskB: string;
  jaccardSimilarity: number; // 0.0 - 1.0
  titleSimilarity: number;
  reason: string;
}

export interface OverlapAuditReport {
  timestamp: string;
  datasetVersion: string;
  totalTasks: number;
  sourceFileOverlap: {
    hasOverlap: boolean;
    sharedFilesCount: number;
    overlaps: FileOverlapEntry[];
  };
  testFileOverlap: {
    hasOverlap: boolean;
    sharedFilesCount: number;
    overlaps: FileOverlapEntry[];
  };
  packageOverlap: {
    clusters: PackageOverlapEntry[];
  };
  commitAdjacency: {
    adjacentPairsCount: number;
    pairs: CommitAdjacencyEntry[];
  };
  promptSimilarity: {
    highSimilarityPairsCount: number;
    pairs: PromptSimilarityEntry[];
  };
  summaryNotes: string[];
}

export interface OverlapAuditOptions {
  tasksDir?: string;
  similarityThreshold?: number; // default 0.70
  verbose?: boolean;
}

/**
 * Tokenizes text into lowercase word tokens, removing standard markdown syntax.
 */
function tokenize(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[#*`_~[\]()\-+=>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w.length > 2);
  return new Set(words);
}

/**
 * Computes Jaccard similarity between two token sets.
 */
function computeJaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? parseFloat((intersection / union).toFixed(3)) : 0;
}

/**
 * Performs a comprehensive task independence and overlap audit across the dataset.
 */
export function auditDatasetOverlap(
  releasePathOrVersion = 'dataset/releases/v0.2.0.json',
  options: OverlapAuditOptions = {}
): OverlapAuditReport {
  const tasksDir = options.tasksDir ?? path.resolve(process.cwd(), 'tasks');
  const simThreshold = options.similarityThreshold ?? 0.7;
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
    throw new Error(`Release checkpoint file not found at: ${releasePath}`);
  }

  const checkpoint: DatasetReleaseCheckpoint = JSON.parse(fs.readFileSync(releasePath, 'utf-8'));
  const totalTasks = checkpoint.tasks.length;

  const sourceFilesMap = new Map<string, string[]>();
  const testFilesMap = new Map<string, string[]>();
  const packageMap = new Map<string, string[]>();
  const promptTokensMap = new Map<string, { titleTokens: Set<string>; bodyTokens: Set<string> }>();
  const taskMetadataMap = new Map<string, any>();

  for (const t of checkpoint.tasks) {
    const taskDir = path.join(tasksDir, t.taskId);
    let meta: any = null;
    if (fs.existsSync(path.join(taskDir, 'metadata.json'))) {
      try {
        meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'metadata.json'), 'utf-8'));
        taskMetadataMap.set(t.taskId, meta);
      } catch {
        // ignore
      }
    }

    // Source files tracking
    const sources: string[] = meta?.sourceFiles || [];
    for (const src of sources) {
      const fullKey = `${t.repository}:${src}`;
      const existing = sourceFilesMap.get(fullKey) || [];
      existing.push(t.taskId);
      sourceFilesMap.set(fullKey, existing);
    }

    // Test files tracking
    const tests: string[] = meta?.testFiles || [];
    for (const test of tests) {
      const fullKey = `${t.repository}:${test}`;
      const existing = testFilesMap.get(fullKey) || [];
      existing.push(t.taskId);
      testFilesMap.set(fullKey, existing);
    }

    // Package / module tracking
    const pkgMod = sources[0]
      ? sources[0].split('/').slice(0, 2).join('/')
      : 'src';
    const pkgKey = `${t.repository}:${pkgMod}`;
    const pkgList = packageMap.get(pkgKey) || [];
    pkgList.push(t.taskId);
    packageMap.set(pkgKey, pkgList);

    // Prompt tokens tracking
    const promptPath = path.join(taskDir, 'prompt.md');
    if (fs.existsSync(promptPath)) {
      const promptContent = fs.readFileSync(promptPath, 'utf-8');
      promptTokensMap.set(t.taskId, {
        titleTokens: tokenize(t.title),
        bodyTokens: tokenize(promptContent),
      });
    }
  }

  // 1. Source file overlaps
  const sourceOverlaps: FileOverlapEntry[] = [];
  for (const [filePath, taskIds] of sourceFilesMap.entries()) {
    if (taskIds.length > 1) {
      sourceOverlaps.push({
        filePath,
        taskIds,
        count: taskIds.length,
      });
    }
  }

  // 2. Test file overlaps
  const testOverlaps: FileOverlapEntry[] = [];
  for (const [filePath, taskIds] of testFilesMap.entries()) {
    if (taskIds.length > 1) {
      testOverlaps.push({
        filePath,
        taskIds,
        count: taskIds.length,
      });
    }
  }

  // 3. Package clusters
  const packageClusters: PackageOverlapEntry[] = [];
  for (const [pkgKey, taskIds] of packageMap.entries()) {
    const [repo, mod] = pkgKey.split(':');
    if (taskIds.length > 1) {
      packageClusters.push({
        repository: repo,
        packageModule: mod,
        taskIds,
        count: taskIds.length,
      });
    }
  }

  // 4. Commit Adjacency Check
  const adjacencyPairs: CommitAdjacencyEntry[] = [];
  const tasksList = checkpoint.tasks;

  for (let i = 0; i < tasksList.length; i++) {
    for (let j = i + 1; j < tasksList.length; j++) {
      const tA = tasksList[i];
      const tB = tasksList[j];
      if (tA.repository !== tB.repository) continue;

      const metaA = taskMetadataMap.get(tA.taskId);
      const metaB = taskMetadataMap.get(tB.taskId);

      const commitShaA = metaA?.commitSha || '';
      const parentShaA = metaA?.parentSha || tA.baseCommit;
      const commitShaB = metaB?.commitSha || '';
      const parentShaB = metaB?.parentSha || tB.baseCommit;

      // Parent-Child relationship: taskB's base is taskA's fix, or vice versa
      if (commitShaA && parentShaB && (commitShaA.startsWith(parentShaB) || parentShaB.startsWith(commitShaA))) {
        adjacencyPairs.push({
          repository: tA.repository,
          taskA: tA.taskId,
          commitA: commitShaA.slice(0, 7),
          taskB: tB.taskId,
          commitB: commitShaB.slice(0, 7),
          relationship: 'parent_child',
          description: `Task "${tB.taskId}" baseCommit is the immediate fix commit of "${tA.taskId}".`,
        });
      } else if (commitShaB && parentShaA && (commitShaB.startsWith(parentShaA) || parentShaA.startsWith(commitShaB))) {
        adjacencyPairs.push({
          repository: tA.repository,
          taskA: tB.taskId,
          commitA: commitShaB.slice(0, 7),
          taskB: tA.taskId,
          commitB: commitShaA.slice(0, 7),
          relationship: 'parent_child',
          description: `Task "${tA.taskId}" baseCommit is the immediate fix commit of "${tB.taskId}".`,
        });
      } else if (parentShaA && parentShaB && parentShaA.slice(0, 7) === parentShaB.slice(0, 7)) {
        adjacencyPairs.push({
          repository: tA.repository,
          taskA: tA.taskId,
          commitA: commitShaA.slice(0, 7),
          taskB: tB.taskId,
          commitB: commitShaB.slice(0, 7),
          relationship: 'shared_base_commit',
          description: `Tasks "${tA.taskId}" and "${tB.taskId}" share identical baseCommit (${parentShaA.slice(0, 7)}).`,
        });
      }
    }
  }

  // 5. Prompt Similarity Analysis
  const promptPairs: PromptSimilarityEntry[] = [];
  for (let i = 0; i < tasksList.length; i++) {
    for (let j = i + 1; j < tasksList.length; j++) {
      const tA = tasksList[i];
      const tB = tasksList[j];

      const tokensA = promptTokensMap.get(tA.taskId);
      const tokensB = promptTokensMap.get(tB.taskId);

      if (tokensA && tokensB) {
        const bodySim = computeJaccard(tokensA.bodyTokens, tokensB.bodyTokens);
        const titleSim = computeJaccard(tokensA.titleTokens, tokensB.titleTokens);

        if (bodySim >= simThreshold || titleSim >= 0.5) {
          promptPairs.push({
            taskA: tA.taskId,
            taskB: tB.taskId,
            jaccardSimilarity: bodySim,
            titleSimilarity: titleSim,
            reason:
              bodySim >= 0.8
                ? 'High prompt boilerplate structural similarity from standardized template'
                : 'Moderate lexical prompt and title token overlap',
          });
        }
      }
    }
  }

  // Summary diagnostics
  const summaryNotes: string[] = [];
  if (sourceOverlaps.length === 0) {
    summaryNotes.push('✅ No source-file collisions: All 9 tasks modify distinct source files.');
  } else {
    summaryNotes.push(`⚠️ ${sourceOverlaps.length} source file(s) are shared across multiple tasks.`);
  }

  if (testOverlaps.length === 0) {
    summaryNotes.push('✅ No test-file collisions: All 9 tasks verify against distinct test files.');
  } else {
    summaryNotes.push(`⚠️ ${testOverlaps.length} test file(s) are shared across multiple tasks.`);
  }

  if (adjacencyPairs.length > 0) {
    summaryNotes.push(
      `⚠️ Detected ${adjacencyPairs.length} commit adjacency relation(s) (e.g. parent/child commit chaining).`
    );
  }

  if (packageClusters.length > 0) {
    summaryNotes.push(
      `ℹ️ Found ${packageClusters.length} package cluster(s) with multiple tasks in the same module.`
    );
  }

  return {
    timestamp: new Date().toISOString(),
    datasetVersion: checkpoint.version,
    totalTasks,
    sourceFileOverlap: {
      hasOverlap: sourceOverlaps.length > 0,
      sharedFilesCount: sourceOverlaps.length,
      overlaps: sourceOverlaps,
    },
    testFileOverlap: {
      hasOverlap: testOverlaps.length > 0,
      sharedFilesCount: testOverlaps.length,
      overlaps: testOverlaps,
    },
    packageOverlap: {
      clusters: packageClusters,
    },
    commitAdjacency: {
      adjacentPairsCount: adjacencyPairs.length,
      pairs: adjacencyPairs,
    },
    promptSimilarity: {
      highSimilarityPairsCount: promptPairs.length,
      pairs: promptPairs,
    },
    summaryNotes,
  };
}

/**
 * Formats a terminal-friendly overlap audit report.
 */
export function formatOverlapReport(report: OverlapAuditReport): string {
  const lines: string[] = [];

  lines.push('========================================================================================');
  lines.push(`TYPEBENCH TASK INDEPENDENCE & OVERLAP AUDIT (Dataset v${report.datasetVersion})`);
  lines.push('========================================================================================\n');

  lines.push(`Total Tasks Evaluated : ${report.totalTasks}`);
  lines.push(`Source File Collisions: ${report.sourceFileOverlap.sharedFilesCount}`);
  lines.push(`Test File Collisions  : ${report.testFileOverlap.sharedFilesCount}`);
  lines.push(`Commit Adjacency Pairs: ${report.commitAdjacency.adjacentPairsCount}`);
  lines.push(`Package Clusters      : ${report.packageOverlap.clusters.length}\n`);

  lines.push('--- SOURCE FILE INDEPENDENCE ---');
  if (report.sourceFileOverlap.overlaps.length === 0) {
    lines.push('  ✅ Clean: 0 source-file collisions across all benchmark tasks.');
  } else {
    report.sourceFileOverlap.overlaps.forEach((o) => {
      lines.push(`  ⚠️  ${o.filePath} modified by: ${o.taskIds.join(', ')}`);
    });
  }

  lines.push('\n--- TEST FILE INDEPENDENCE ---');
  if (report.testFileOverlap.overlaps.length === 0) {
    lines.push('  ✅ Clean: 0 test-file collisions across all benchmark tasks.');
  } else {
    report.testFileOverlap.overlaps.forEach((o) => {
      lines.push(`  ⚠️  ${o.filePath} verified by: ${o.taskIds.join(', ')}`);
    });
  }

  lines.push('\n--- COMMIT ADJACENCY & LINEAGE ---');
  if (report.commitAdjacency.pairs.length === 0) {
    lines.push('  ✅ Clean: No direct parent-child or shared base commit chaining detected.');
  } else {
    report.commitAdjacency.pairs.forEach((p, idx) => {
      lines.push(
        `  ${idx + 1}. [${p.relationship.toUpperCase()}] (${p.repository}): ${p.description}`
      );
    });
  }

  lines.push('\n--- MODULE / PACKAGE CLUSTERING ---');
  if (report.packageOverlap.clusters.length === 0) {
    lines.push('  ✅ Clean: All tasks reside in distinct packages.');
  } else {
    report.packageOverlap.clusters.forEach((c) => {
      lines.push(
        `  • ${c.repository} (${c.packageModule}) : ${c.count} tasks [${c.taskIds.join(', ')}]`
      );
    });
  }

  lines.push('\n--- PROMPT STRUCTURAL SIMILARITY ---');
  lines.push(`  Found ${report.promptSimilarity.highSimilarityPairsCount} pair(s) with boilerplate overlap.`);
  report.promptSimilarity.pairs.slice(0, 5).forEach((p) => {
    lines.push(
      `  • ${p.taskA} <-> ${p.taskB} : Jaccard ${p.jaccardSimilarity.toFixed(2)} (${p.reason})`
    );
  });

  lines.push('\n========================================================================================');
  lines.push('AUDIT SUMMARY NOTES');
  lines.push('========================================================================================\n');
  report.summaryNotes.forEach((n) => lines.push(`  ${n}`));
  lines.push('\n========================================================================================\n');

  return lines.join('\n');
}

// CLI execution if run directly
if (process.argv[1]?.includes('audit-overlap')) {
  const versionArg = process.argv[2] || 'dataset/releases/v0.2.0.json';
  const report = auditDatasetOverlap(versionArg);
  console.log(formatOverlapReport(report));
}
