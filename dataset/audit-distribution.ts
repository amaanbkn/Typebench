/**
 * TypeBench Dataset Distribution & Balance Auditor
 * Analyzes task distributions across repositories, categories, difficulties, modules,
 * diff sizes, test frameworks, and package managers to diagnose dataset imbalances.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatasetReleaseCheckpoint } from './freeze.js';

export interface TaskDistributionItem {
  taskId: string;
  repository: string;
  category: string;
  difficulty: string;
  packageManager: string;
  packageModule: string;
  sourceFilesCount: number;
  testFilesCount: number;
  approxDiffSize: number;
  testRunner: string;
  taskStatus: string;
}

export interface DistributionWarning {
  dimension: string;
  level: 'warning' | 'info';
  message: string;
  recommendation: string;
}

export interface DistributionAuditReport {
  timestamp: string;
  datasetVersion: string;
  totalTasks: number;
  repositoryDistribution: Record<string, { count: number; percentage: number }>;
  categoryDistribution: Record<string, { count: number; percentage: number }>;
  difficultyDistribution: Record<string, { count: number; percentage: number }>;
  packageManagerDistribution: Record<string, { count: number; percentage: number }>;
  testRunnerDistribution: Record<string, { count: number; percentage: number }>;
  moduleDistribution: Record<string, { count: number; percentage: number }>;
  taskStatusDistribution: Record<string, { count: number; percentage: number }>;
  filesChangedStats: {
    avgSourceFiles: number;
    avgTestFiles: number;
    maxSourceFiles: number;
    maxTestFiles: number;
  };
  tasks: TaskDistributionItem[];
  warnings: DistributionWarning[];
}

export interface DistributionAuditOptions {
  tasksDir?: string;
  verbose?: boolean;
}

/**
 * Infers the module / package from test or source file paths.
 */
function inferModule(repo: string, testCommand: string, metadata?: any): string {
  if (metadata?.sourceFiles?.[0]) {
    const src = metadata.sourceFiles[0];
    const parts = src.split('/');
    if (parts.length > 2 && parts[0] === 'packages') {
      return `${repo}:${parts[0]}/${parts[1]}`;
    }
    if (parts.length > 1) {
      return `${repo}:${parts[0]}/${parts[1]}`;
    }
    return `${repo}:${parts[0]}`;
  }
  if (testCommand.includes('packages/')) {
    const match = testCommand.match(/packages\/([^/]+)/);
    if (match) return `${repo}:packages/${match[1]}`;
  }
  return `${repo}:src`;
}

/**
 * Infers the test runner used in testCommand.
 */
function inferTestRunner(testCommand: string): string {
  if (testCommand.includes('vitest')) return 'vitest';
  if (testCommand.includes('jest')) return 'jest';
  if (testCommand.includes('tsx') || testCommand.includes('ts-node')) return 'custom-ts';
  // Common for npm/pnpm test in modern TS repos
  return 'vitest/jest';
}

/**
 * Audits task distribution across the frozen dataset release or manifest.
 */
export function auditDatasetDistribution(
  releasePathOrVersion = 'dataset/releases/v0.2.0.json',
  options: DistributionAuditOptions = {}
): DistributionAuditReport {
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
    throw new Error(`Release checkpoint file not found at: ${releasePath}`);
  }

  const checkpoint: DatasetReleaseCheckpoint = JSON.parse(fs.readFileSync(releasePath, 'utf-8'));
  const totalTasks = checkpoint.tasks.length;

  const repoCounts: Record<string, number> = {};
  const catCounts: Record<string, number> = {};
  const diffCounts: Record<string, number> = {};
  const pmCounts: Record<string, number> = {};
  const trCounts: Record<string, number> = {};
  const modCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  const taskItems: TaskDistributionItem[] = [];
  let totalSources = 0;
  let totalTests = 0;
  let maxSources = 0;
  let maxTests = 0;

  for (const t of checkpoint.tasks) {
    const taskDir = path.join(tasksDir, t.taskId);
    let meta: any = null;
    if (fs.existsSync(path.join(taskDir, 'metadata.json'))) {
      try {
        meta = JSON.parse(fs.readFileSync(path.join(taskDir, 'metadata.json'), 'utf-8'));
      } catch {
        // ignore
      }
    }

    const srcCount = meta?.sourceFiles?.length || 1;
    const testCount = meta?.testFiles?.length || 1;
    totalSources += srcCount;
    totalTests += testCount;
    maxSources = Math.max(maxSources, srcCount);
    maxTests = Math.max(maxTests, testCount);

    const mod = inferModule(t.repository, t.testCommand, meta);
    const tr = inferTestRunner(t.testCommand);
    const approxDiff = (meta?.changedFiles?.length || 2) * 25; // heuristic lines changed

    repoCounts[t.repository] = (repoCounts[t.repository] || 0) + 1;
    catCounts[t.category] = (catCounts[t.category] || 0) + 1;
    diffCounts[t.difficulty] = (diffCounts[t.difficulty] || 0) + 1;
    pmCounts[t.packageManager] = (pmCounts[t.packageManager] || 0) + 1;
    trCounts[tr] = (trCounts[tr] || 0) + 1;
    modCounts[mod] = (modCounts[mod] || 0) + 1;
    statusCounts[t.taskStatus] = (statusCounts[t.taskStatus] || 0) + 1;

    taskItems.push({
      taskId: t.taskId,
      repository: t.repository,
      category: t.category,
      difficulty: t.difficulty,
      packageManager: t.packageManager,
      packageModule: mod,
      sourceFilesCount: srcCount,
      testFilesCount: testCount,
      approxDiffSize: approxDiff,
      testRunner: tr,
      taskStatus: t.taskStatus,
    });
  }

  // Calculate percentages helper
  const toDistMap = (counts: Record<string, number>) => {
    const result: Record<string, { count: number; percentage: number }> = {};
    for (const [k, v] of Object.entries(counts)) {
      result[k] = {
        count: v,
        percentage: totalTasks > 0 ? parseFloat(((v / totalTasks) * 100).toFixed(1)) : 0,
      };
    }
    return result;
  };

  const repoDist = toDistMap(repoCounts);
  const catDist = toDistMap(catCounts);
  const diffDist = toDistMap(diffCounts);
  const pmDist = toDistMap(pmCounts);
  const trDist = toDistMap(trCounts);
  const modDist = toDistMap(modCounts);
  const statusDist = toDistMap(statusCounts);

  // Diagnostic warning detection
  const warnings: DistributionWarning[] = [];

  // 1. Repository concentration check
  for (const [repo, data] of Object.entries(repoDist)) {
    if (data.percentage > 50) {
      warnings.push({
        dimension: 'repository',
        level: 'warning',
        message: `Repository "${repo}" constitutes ${data.percentage}% of the dataset (${data.count}/${totalTasks} tasks).`,
        recommendation: 'Incorporate additional repositories to prevent benchmark overfitting to a single repository pattern.',
      });
    }
  }

  // 2. Category concentration check
  for (const [cat, data] of Object.entries(catDist)) {
    if (data.percentage > 60) {
      warnings.push({
        dimension: 'category',
        level: 'warning',
        message: `Task category "${cat}" dominates dataset with ${data.percentage}% share (${data.count}/${totalTasks} tasks).`,
        recommendation: 'Expand category diversity by including more "type_fix", "feature", and "refactor" tasks.',
      });
    }
  }

  // 3. Difficulty concentration check
  for (const [diff, data] of Object.entries(diffDist)) {
    if (data.percentage > 60) {
      warnings.push({
        dimension: 'difficulty',
        level: 'warning',
        message: `Difficulty level "${diff}" comprises ${data.percentage}% of all tasks (${data.count}/${totalTasks} tasks).`,
        recommendation: 'Balance difficulty gradient with more "medium" and "hard" multi-file tasks.',
      });
    }
  }

  // 4. Package manager concentration
  for (const [pm, data] of Object.entries(pmDist)) {
    if (data.percentage > 70) {
      warnings.push({
        dimension: 'package_manager',
        level: 'info',
        message: `Package manager "${pm}" represents ${data.percentage}% of the benchmark tasks.`,
        recommendation: 'Ensure support for yarn/npm workspaces is equally represented.',
      });
    }
  }

  // 5. Module concentration check
  for (const [mod, data] of Object.entries(modDist)) {
    if (data.count >= 3 && data.percentage >= 33.3) {
      warnings.push({
        dimension: 'module_concentration',
        level: 'warning',
        message: `Module "${mod}" contains ${data.count} tasks (${data.percentage}% of suite).`,
        recommendation: 'Diversify tasks across different subpackages and domain logic in the repository.',
      });
    }
  }

  // 6. Task readiness status check
  if (statusDist['needs-review']?.percentage === 100) {
    warnings.push({
      dimension: 'task_status',
      level: 'warning',
      message: '100% of tasks are currently flagged as "needs-review" rather than "ready".',
      recommendation: 'Run full container sandbox readiness checks to promote validated tasks to "ready".',
    });
  }

  return {
    timestamp: new Date().toISOString(),
    datasetVersion: checkpoint.version,
    totalTasks,
    repositoryDistribution: repoDist,
    categoryDistribution: catDist,
    difficultyDistribution: diffDist,
    packageManagerDistribution: pmDist,
    testRunnerDistribution: trDist,
    moduleDistribution: modDist,
    taskStatusDistribution: statusDist,
    filesChangedStats: {
      avgSourceFiles: totalTasks > 0 ? parseFloat((totalSources / totalTasks).toFixed(2)) : 0,
      avgTestFiles: totalTasks > 0 ? parseFloat((totalTests / totalTasks).toFixed(2)) : 0,
      maxSourceFiles: maxSources,
      maxTestFiles: maxTests,
    },
    tasks: taskItems,
    warnings,
  };
}

/**
 * Formats a terminal-friendly distribution audit report.
 */
export function formatDistributionReport(report: DistributionAuditReport): string {
  const lines: string[] = [];

  lines.push('========================================================================================');
  lines.push(`TYPEBENCH DATASET DISTRIBUTION AUDIT (Dataset v${report.datasetVersion})`);
  lines.push('========================================================================================\n');

  lines.push(`Total Benchmark Tasks: ${report.totalTasks}`);
  lines.push(`Average Source Files : ${report.filesChangedStats.avgSourceFiles} (max: ${report.filesChangedStats.maxSourceFiles})`);
  lines.push(`Average Test Files   : ${report.filesChangedStats.avgTestFiles} (max: ${report.filesChangedStats.maxTestFiles})\n`);

  lines.push('--- REPOSITORY DISTRIBUTION ---');
  for (const [k, v] of Object.entries(report.repositoryDistribution)) {
    lines.push(`  • ${k.padEnd(16, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n--- CATEGORY DISTRIBUTION ---');
  for (const [k, v] of Object.entries(report.categoryDistribution)) {
    lines.push(`  • ${k.padEnd(16, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n--- DIFFICULTY DISTRIBUTION ---');
  for (const [k, v] of Object.entries(report.difficultyDistribution)) {
    lines.push(`  • ${k.padEnd(16, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n--- PACKAGE MANAGER DISTRIBUTION ---');
  for (const [k, v] of Object.entries(report.packageManagerDistribution)) {
    lines.push(`  • ${k.padEnd(16, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n--- TEST RUNNER / HARNESS ---');
  for (const [k, v] of Object.entries(report.testRunnerDistribution)) {
    lines.push(`  • ${k.padEnd(16, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n--- MODULE CONCENTRATION ---');
  for (const [k, v] of Object.entries(report.moduleDistribution)) {
    lines.push(`  • ${k.padEnd(30, ' ')} : ${String(v.count).padStart(2, ' ')} (${v.percentage.toFixed(1)}%)`);
  }

  lines.push('\n========================================================================================');
  lines.push('DISTRIBUTION DIAGNOSTIC WARNINGS & IMBALANCE SIGNALS');
  lines.push('========================================================================================\n');

  if (report.warnings.length === 0) {
    lines.push('  ✅ No distribution imbalances or suspicious concentrations detected.');
  } else {
    report.warnings.forEach((w, idx) => {
      const tag = w.level === 'warning' ? '⚠️  [WARNING]' : 'ℹ️  [INFO]';
      lines.push(`${idx + 1}. ${tag} (${w.dimension}): ${w.message}`);
      lines.push(`   Recommendation: ${w.recommendation}\n`);
    });
  }

  lines.push('========================================================================================\n');
  return lines.join('\n');
}

// CLI execution if run directly
if (process.argv[1]?.includes('audit-distribution')) {
  const versionArg = process.argv[2] || 'dataset/releases/v0.2.0.json';
  const report = auditDatasetDistribution(versionArg);
  console.log(formatDistributionReport(report));
}
