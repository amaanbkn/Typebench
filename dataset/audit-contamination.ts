/**
 * TypeBench Anti-Contamination & Ground-Truth Leakage Auditor
 * Inspects all agent-facing files (task.json, prompt.md) to ensure complete isolation
 * from historical fix SHAs, original commit messages, expected changed files, candidate scores,
 * discovery signals, validation internals, metadata.json, and ground-truth patches.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatasetReleaseCheckpoint } from './freeze.js';

export type ContaminationCategory =
  | 'historical_fix_sha'
  | 'parent_fix_relationship'
  | 'original_commit_message'
  | 'expected_changed_files'
  | 'candidate_score'
  | 'discovery_signals'
  | 'validation_status'
  | 'metadata_json_reference'
  | 'release_internals'
  | 'ground_truth_patch';

export interface ContaminationLeak {
  taskId: string;
  file: 'task.json' | 'prompt.md';
  category: ContaminationCategory;
  description: string;
  matchedSnippet: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface ContaminationAuditReport {
  timestamp: string;
  datasetVersion: string;
  totalTasks: number;
  isClean: boolean;
  contaminationDetected: boolean;
  totalLeaksCount: number;
  leaks: ContaminationLeak[];
  inspectedFiles: {
    taskJsonCount: number;
    promptMdCount: number;
  };
  summaryByCategory: Record<ContaminationCategory, number>;
}

export interface ContaminationAuditOptions {
  tasksDir?: string;
  verbose?: boolean;
}

/**
 * Inspects a single task's agent-facing files against internal metadata ground-truth.
 */
export function inspectTaskForContamination(
  taskDir: string,
  taskId: string
): ContaminationLeak[] {
  const leaks: ContaminationLeak[] = [];
  const taskJsonPath = path.join(taskDir, 'task.json');
  const promptMdPath = path.join(taskDir, 'prompt.md');
  const metaJsonPath = path.join(taskDir, 'metadata.json');

  let metadata: any = null;
  if (fs.existsSync(metaJsonPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  // 1. Inspect task.json (agent-facing definition)
  if (fs.existsSync(taskJsonPath)) {
    const rawTaskJson = fs.readFileSync(taskJsonPath, 'utf-8');
    let taskJson: any = null;
    try {
      taskJson = JSON.parse(rawTaskJson);
    } catch {
      // ignore
    }

    // Check 1.1: Historical Fix Commit SHA (full 40 hex chars)
    if (metadata?.commitSha && rawTaskJson.includes(metadata.commitSha)) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'historical_fix_sha',
        description: 'task.json contains full 40-character target fix commit SHA.',
        matchedSnippet: metadata.commitSha,
        severity: 'critical',
      });
    }

    // Check 1.2: Parent / Fix Commit Relationship
    if (taskJson?.parentSha || taskJson?.commitSha || taskJson?.fixCommit) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'parent_fix_relationship',
        description: 'task.json exposes commit lineage or fix commit fields.',
        matchedSnippet: JSON.stringify({ parentSha: taskJson.parentSha, commitSha: taskJson.commitSha }),
        severity: 'critical',
      });
    }

    // Check 1.3: Original Commit Message & PR number
    if (metadata?.originalCommitMessage) {
      const prMatch = metadata.originalCommitMessage.match(/#(\d+)/);
      if (prMatch && rawTaskJson.includes(prMatch[0])) {
        leaks.push({
          taskId,
          file: 'task.json',
          category: 'original_commit_message',
          description: `task.json contains original PR identifier ${prMatch[0]}.`,
          matchedSnippet: prMatch[0],
          severity: 'high',
        });
      }
      if (rawTaskJson.includes(metadata.originalCommitMessage)) {
        leaks.push({
          taskId,
          file: 'task.json',
          category: 'original_commit_message',
          description: 'task.json contains raw uncurated original commit message.',
          matchedSnippet: metadata.originalCommitMessage,
          severity: 'high',
        });
      }
    }

    // Check 1.4: Expected Changed Source Files
    if (taskJson?.sourceFiles || taskJson?.changedFiles) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'expected_changed_files',
        description: 'task.json leaks ground-truth list of source files to edit.',
        matchedSnippet: JSON.stringify(taskJson.sourceFiles || taskJson.changedFiles),
        severity: 'high',
      });
    }

    // Check 1.5: Candidate Score
    if (taskJson?.candidateScore !== undefined || rawTaskJson.includes('candidateScore')) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'candidate_score',
        description: 'task.json contains internal curation candidateScore.',
        matchedSnippet: `candidateScore: ${taskJson?.candidateScore}`,
        severity: 'medium',
      });
    }

    // Check 1.6: Discovery Signals
    if (taskJson?.signals || rawTaskJson.includes('positiveSignals') || rawTaskJson.includes('fix-keyword')) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'discovery_signals',
        description: 'task.json contains automated discovery signals or heuristics.',
        matchedSnippet: JSON.stringify(taskJson?.signals || 'signals'),
        severity: 'medium',
      });
    }

    // Check 1.7: Validation Status (internal validation details)
    if (taskJson?.validationStatus || taskJson?.validationReason || rawTaskJson.includes('validationReason')) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'validation_status',
        description: 'task.json exposes internal validationStatus or validationReason.',
        matchedSnippet: JSON.stringify({ validationStatus: taskJson.validationStatus }),
        severity: 'high',
      });
    }

    // Check 1.8: metadata.json References
    if (rawTaskJson.includes('metadata.json')) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'metadata_json_reference',
        description: 'task.json contains explicit reference to metadata.json.',
        matchedSnippet: 'metadata.json',
        severity: 'medium',
      });
    }

    // Check 1.9: Release Internals
    if (rawTaskJson.includes('datasetFingerprint') || rawTaskJson.includes('datasetChecksum')) {
      leaks.push({
        taskId,
        file: 'task.json',
        category: 'release_internals',
        description: 'task.json contains release checkpoint fingerprint or internal hashes.',
        matchedSnippet: 'datasetFingerprint',
        severity: 'medium',
      });
    }
  }

  // 2. Inspect prompt.md (agent-facing instruction)
  if (fs.existsSync(promptMdPath)) {
    const rawPrompt = fs.readFileSync(promptMdPath, 'utf-8');

    // Check 2.1: Historical Fix Commit SHA
    if (metadata?.commitSha && rawPrompt.includes(metadata.commitSha)) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'historical_fix_sha',
        description: 'prompt.md contains full 40-character target fix commit SHA.',
        matchedSnippet: metadata.commitSha,
        severity: 'critical',
      });
    }

    // Check 2.2: Parent / Fix Commit Relationships
    if (rawPrompt.toLowerCase().includes('commit sha') || rawPrompt.toLowerCase().includes('fix commit')) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'parent_fix_relationship',
        description: 'prompt.md contains explicit mentions of historical commit hashes or fix commits.',
        matchedSnippet: 'fix commit / commit sha',
        severity: 'critical',
      });
    }

    // Check 2.3: Original Commit Message & PR number
    if (metadata?.originalCommitMessage) {
      const prMatch = metadata.originalCommitMessage.match(/#(\d+)/);
      if (prMatch && rawPrompt.includes(prMatch[0])) {
        leaks.push({
          taskId,
          file: 'prompt.md',
          category: 'original_commit_message',
          description: `prompt.md leaks original GitHub PR number ${prMatch[0]}.`,
          matchedSnippet: prMatch[0],
          severity: 'high',
        });
      }
      if (rawPrompt.includes(metadata.originalCommitMessage)) {
        leaks.push({
          taskId,
          file: 'prompt.md',
          category: 'original_commit_message',
          description: 'prompt.md contains raw uncurated original commit message.',
          matchedSnippet: metadata.originalCommitMessage,
          severity: 'high',
        });
      }
    }

    // Check 2.4: Expected Changed Source Files (e.g. "Edit src/foo/bar.ts")
    if (metadata?.sourceFiles) {
      for (const src of metadata.sourceFiles) {
        // Checking if prompt explicitly tells the agent to edit this exact source file
        const regex = new RegExp(`(modify|edit|update|change|in file)\\s+[\`']?${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\`']?`, 'i');
        if (regex.test(rawPrompt)) {
          leaks.push({
            taskId,
            file: 'prompt.md',
            category: 'expected_changed_files',
            description: `prompt.md instructs agent with exact target source file to edit (${src}).`,
            matchedSnippet: src,
            severity: 'high',
          });
        }
      }
    }

    // Check 2.5: Candidate Score
    if (rawPrompt.includes('candidateScore') || rawPrompt.includes('Candidate score:')) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'candidate_score',
        description: 'prompt.md references internal curation candidateScore.',
        matchedSnippet: 'candidateScore',
        severity: 'medium',
      });
    }

    // Check 2.6: Discovery Signals
    if (rawPrompt.includes('positiveSignals') || rawPrompt.includes('signals:')) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'discovery_signals',
        description: 'prompt.md references automated discovery signals.',
        matchedSnippet: 'positiveSignals',
        severity: 'medium',
      });
    }

    // Check 2.7: Validation Status
    if (rawPrompt.includes('validationStatus') || rawPrompt.includes('validationReason')) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'validation_status',
        description: 'prompt.md leaks internal validation status.',
        matchedSnippet: 'validationStatus',
        severity: 'high',
      });
    }

    // Check 2.8: metadata.json References
    if (rawPrompt.includes('metadata.json')) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'metadata_json_reference',
        description: 'prompt.md references internal metadata.json file.',
        matchedSnippet: 'metadata.json',
        severity: 'medium',
      });
    }

    // Check 2.9: Ground-Truth Patch Information (Unified diff syntax)
    if (
      rawPrompt.includes('diff --git') ||
      rawPrompt.includes('@@ -') ||
      rawPrompt.includes('--- a/') ||
      rawPrompt.includes('+++ b/')
    ) {
      leaks.push({
        taskId,
        file: 'prompt.md',
        category: 'ground_truth_patch',
        description: 'prompt.md contains ground-truth diff / patch blocks.',
        matchedSnippet: 'diff --git',
        severity: 'critical',
      });
    }
  }

  return leaks;
}

/**
 * Performs a dataset-wide contamination audit.
 */
export function auditDatasetContamination(
  releasePathOrVersion = 'dataset/releases/v0.2.0.json',
  options: ContaminationAuditOptions = {}
): ContaminationAuditReport {
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

  const allLeaks: ContaminationLeak[] = [];
  let taskJsonCount = 0;
  let promptMdCount = 0;

  const summaryByCategory: Record<ContaminationCategory, number> = {
    historical_fix_sha: 0,
    parent_fix_relationship: 0,
    original_commit_message: 0,
    expected_changed_files: 0,
    candidate_score: 0,
    discovery_signals: 0,
    validation_status: 0,
    metadata_json_reference: 0,
    release_internals: 0,
    ground_truth_patch: 0,
  };

  for (const t of checkpoint.tasks) {
    const taskDir = path.join(tasksDir, t.taskId);
    if (fs.existsSync(path.join(taskDir, 'task.json'))) taskJsonCount++;
    if (fs.existsSync(path.join(taskDir, 'prompt.md'))) promptMdCount++;

    const taskLeaks = inspectTaskForContamination(taskDir, t.taskId);
    for (const leak of taskLeaks) {
      allLeaks.push(leak);
      summaryByCategory[leak.category]++;
    }
  }

  const contaminationDetected = allLeaks.length > 0;

  return {
    timestamp: new Date().toISOString(),
    datasetVersion: checkpoint.version,
    totalTasks,
    isClean: !contaminationDetected,
    contaminationDetected,
    totalLeaksCount: allLeaks.length,
    leaks: allLeaks,
    inspectedFiles: {
      taskJsonCount,
      promptMdCount,
    },
    summaryByCategory,
  };
}

/**
 * Formats a terminal-friendly contamination audit report.
 */
export function formatContaminationReport(report: ContaminationAuditReport): string {
  const lines: string[] = [];

  lines.push('========================================================================================');
  lines.push(`TYPEBENCH ANTI-CONTAMINATION AUDIT REPORT (Dataset v${report.datasetVersion})`);
  lines.push('========================================================================================\n');

  lines.push(`Total Tasks Inspected : ${report.totalTasks}`);
  lines.push(`Agent-Facing Files    : ${report.inspectedFiles.taskJsonCount} task.json, ${report.inspectedFiles.promptMdCount} prompt.md`);
  lines.push(`Total Leaks Found     : ${report.totalLeaksCount}\n`);

  lines.push('--- LEAKAGE BREAKDOWN BY CATEGORY ---');
  for (const [cat, count] of Object.entries(report.summaryByCategory)) {
    const icon = count === 0 ? '✅' : '❌';
    lines.push(`  ${icon} ${cat.padEnd(26, ' ')} : ${count} leak(s) detected`);
  }

  lines.push('\n========================================================================================');
  if (report.contaminationDetected) {
    lines.push('🚨 CONTAMINATION DETECTED 🚨');
    lines.push('========================================================================================\n');

    report.leaks.forEach((leak, idx) => {
      lines.push(
        `${idx + 1}. [${leak.severity.toUpperCase()}] Task: ${leak.taskId} (${leak.file}) - ${leak.category}`
      );
      lines.push(`   Description: ${leak.description}`);
      lines.push(`   Snippet    : "${leak.matchedSnippet}"\n`);
    });
  } else {
    lines.push('🛡️  ANTI-CONTAMINATION AUDIT PASSED: ZERO LEAKAGE DETECTED');
    lines.push('========================================================================================\n');
    lines.push('  ✅ All agent-facing files (task.json, prompt.md) are strictly isolated from:');
    lines.push('     - Historical fix commit SHAs');
    lines.push('     - Parent/fix commit relationships');
    lines.push('     - Raw commit messages & PR identifiers');
    lines.push('     - Ground-truth expected changed files');
    lines.push('     - Candidate discovery scores & signals');
    lines.push('     - Validation status & metadata.json references');
    lines.push('     - Ground-truth diffs and patch snippets');
  }

  lines.push('========================================================================================\n');
  return lines.join('\n');
}

// CLI execution if run directly
if (process.argv[1]?.includes('audit-contamination')) {
  const versionArg = process.argv[2] || 'dataset/releases/v0.2.0.json';
  const report = auditDatasetContamination(versionArg);
  console.log(formatContaminationReport(report));
  if (report.contaminationDetected) {
    console.error('CONTAMINATION DETECTED');
    process.exit(1);
  }
}
