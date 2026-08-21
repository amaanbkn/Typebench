/**
 * TypeBench Candidate Commit Discovery Utility
 * Analyzes structured Git commits and extracts benchmark candidate tasks using deterministic heuristics.
 */

import { CommitInfo } from './git-history.js';

export type CandidateCategory =
  | 'bug_fix'
  | 'type_fix'
  | 'regression'
  | 'feature'
  | 'test_related'
  | 'unknown';

export interface SignalDetails {
  positive: string[];
  negative: string[];
}

export interface CandidateCommit extends CommitInfo {
  isCandidate: boolean;
  score: number;
  category: CandidateCategory;
  signals: SignalDetails;
  hasTestsChanged: boolean;
  testFiles: string[];
  sourceFiles: string[];
  docFiles: string[];
  configFiles: string[];
  rejectionReason?: string;
}

export interface DiscoveryOptions {
  minScore?: number;
  verbose?: boolean;
}

export interface DiscoveryResult {
  totalInspected: number;
  candidates: CandidateCommit[];
  noiseFiltered: CandidateCommit[];
}

const TEST_FILE_REGEX = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const TEST_DIR_REGEX = /(?:^|\/)(?:test|tests|spec|specs|__tests__|fixtures?)\//i;
const TS_SRC_REGEX = /\.(ts|tsx)$/i;
const JS_SRC_REGEX = /\.(js|jsx|mjs|cjs)$/i;
const DOCS_REGEX = /\.(md|markdown|mdx|txt|rst)$/i;
const DOCS_DIR_REGEX = /(?:^|\/)(?:docs|documentation|website|www)\//i;
const CONFIG_REGEX = /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|turbo\.json|tsconfig.*\.json|\.eslintrc|\.prettier.*|\.github\/|\.npmrc|\.nvmrc|lerna\.json|LICENSE)$/i;

/**
 * Classifies the changed files in a commit.
 */
export function classifyFiles(files: string[] = []): {
  testFiles: string[];
  sourceFiles: string[];
  docFiles: string[];
  configFiles: string[];
  hasTestsChanged: boolean;
  hasSourceChanged: boolean;
} {
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];
  const docFiles: string[] = [];
  const configFiles: string[] = [];

  for (const file of files) {
    const isTest = TEST_FILE_REGEX.test(file) || TEST_DIR_REGEX.test(file);
    const isDoc = DOCS_REGEX.test(file) || DOCS_DIR_REGEX.test(file);
    const isConfig = CONFIG_REGEX.test(file);
    const isTs = TS_SRC_REGEX.test(file);
    const isJs = JS_SRC_REGEX.test(file);

    if (isTest) {
      testFiles.push(file);
    } else if (isDoc) {
      docFiles.push(file);
    } else if (isConfig) {
      configFiles.push(file);
    } else if (isTs || isJs) {
      sourceFiles.push(file);
    } else {
      configFiles.push(file);
    }
  }

  return {
    testFiles,
    sourceFiles,
    docFiles,
    configFiles,
    hasTestsChanged: testFiles.length > 0,
    hasSourceChanged: sourceFiles.length > 0,
  };
}

/**
 * Analyzes a commit and computes deterministic scoring and classification.
 */
export function evaluateCommit(commit: CommitInfo, minScore = 3): CandidateCommit {
  const message = commit.message.toLowerCase();
  const firstLine = commit.message.split('\n')[0].toLowerCase();
  const changedFiles = commit.changedFiles || [];

  const {
    testFiles,
    sourceFiles,
    docFiles,
    configFiles,
    hasTestsChanged,
    hasSourceChanged,
  } = classifyFiles(changedFiles);

  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  let score = 0;

  // 1. Commit Message Positive Signals
  const isFix = /\b(fix|bug|bugfix|fixes|fixed|issue|error|incorrect|broken|crash|patch|resolve|resolves|closed|closes)\b/i.test(message);
  const isRegression = /\b(regression|revert|regressed)\b/i.test(message);
  const isFeature = /\b(feat|feature|implement|implements|support|supports|add|adds|added|improve|improves|handle|handles|allow|allows)\b/i.test(message);
  const isTypeRelated = /\b(type|types|typing|typings|typescript|generic|generics|inference|infer|tsc|d\.ts)\b/i.test(message);
  const isEdgeCase = /\b(edge case|edge-case|corner case|boundary)\b/i.test(message);

  if (isFix) {
    score += 2;
    positiveSignals.push('fix-keyword');
  }
  if (isRegression) {
    score += 2;
    positiveSignals.push('regression-keyword');
  }
  if (isFeature) {
    score += 1;
    positiveSignals.push('feature-keyword');
  }
  if (isTypeRelated) {
    score += 2;
    positiveSignals.push('typescript-type-signal');
  }
  if (isEdgeCase) {
    score += 1;
    positiveSignals.push('edge-case-handling');
  }

  // 2. Commit Message Negative Signals
  const isDocsOnlyMsg = /\b(docs?|documentation|readme|sponsors|typo|license)\b/i.test(firstLine);
  const isChoreOrRelease = /\b(chore|release|version bump|bump|changeset|v\d+\.\d+)\b/i.test(firstLine);
  const isDepsOrLockfile = /\b(deps|dependency|dependencies|renovate|dependabot|lockfile|upgrade|update dependency)\b/i.test(firstLine);
  const isFormatting = /\b(format|formatting|prettier|eslint|style|lint)\b/i.test(firstLine);
  const isMerge = /^merge (branch|pull request|remote)/i.test(firstLine);

  if (isDocsOnlyMsg) {
    score -= 3;
    negativeSignals.push('docs-message');
  }
  if (isChoreOrRelease) {
    score -= 2;
    negativeSignals.push('chore-or-release');
  }
  if (isDepsOrLockfile) {
    score -= 3;
    negativeSignals.push('dependency-update');
  }
  if (isFormatting) {
    score -= 2;
    negativeSignals.push('formatting-only');
  }
  if (isMerge) {
    score -= 4;
    negativeSignals.push('merge-commit');
  }

  // 3. File System Change Signals
  if (hasTestsChanged) {
    score += 3;
    positiveSignals.push(`tests-modified (${testFiles.length} files)`);
  }

  if (hasSourceChanged) {
    score += 3;
    positiveSignals.push(`source-modified (${sourceFiles.length} files)`);
  }

  if (hasSourceChanged && hasTestsChanged) {
    score += 2;
    positiveSignals.push('co-located-source-and-test');
  }

  // Scope penalty / bonus
  if (changedFiles.length >= 1 && changedFiles.length <= 15) {
    score += 1;
    positiveSignals.push('focused-atomic-scope');
  } else if (changedFiles.length > 50) {
    score -= 3;
    negativeSignals.push(`large-diff-scope (${changedFiles.length} files)`);
  }

  // 4. Obvious Noise Deductions & Categorization
  let rejectionReason: string | undefined;

  const isDocsOnlyFiles = changedFiles.length > 0 && docFiles.length === changedFiles.length;
  const isConfigOnlyFiles = changedFiles.length > 0 && configFiles.length === changedFiles.length;
  const isLockfileOnly = changedFiles.length === 1 && /lock|package\.json/i.test(changedFiles[0]);

  if (isDocsOnlyFiles) {
    rejectionReason = 'Documentation-only changes';
    score = Math.min(score, 0);
  } else if (isConfigOnlyFiles) {
    rejectionReason = 'Configuration/metadata-only changes';
    score = Math.min(score, 0);
  } else if (isMerge) {
    rejectionReason = 'Merge commit';
    score = Math.min(score, 0);
  } else if (isDepsOrLockfile && !hasSourceChanged) {
    rejectionReason = 'Dependency bump without source changes';
    score = Math.min(score, 0);
  } else if (isChoreOrRelease && !hasTestsChanged) {
    rejectionReason = 'Release or chore commit without tests';
    score = Math.min(score, 0);
  } else if (score < minScore) {
    rejectionReason = `Score ${score} below candidate threshold (${minScore})`;
  }

  // 5. Category classification
  let category: CandidateCategory = 'unknown';
  if (isRegression) {
    category = 'regression';
  } else if (isTypeRelated && (isFix || hasSourceChanged)) {
    category = 'type_fix';
  } else if (isFix) {
    category = 'bug_fix';
  } else if (isFeature) {
    category = 'feature';
  } else if (hasTestsChanged && !hasSourceChanged) {
    category = 'test_related';
  } else if (hasSourceChanged && hasTestsChanged) {
    category = 'bug_fix';
  }

  const isCandidate = score >= minScore && !rejectionReason;

  return {
    ...commit,
    isCandidate,
    score,
    category,
    signals: {
      positive: positiveSignals,
      negative: negativeSignals,
    },
    hasTestsChanged,
    testFiles,
    sourceFiles,
    docFiles,
    configFiles,
    rejectionReason,
  };
}

/**
 * Discovers candidate commits from structured Git history.
 */
export function discoverCandidates(
  commits: CommitInfo[],
  options: DiscoveryOptions = {}
): DiscoveryResult {
  const minScore = options.minScore ?? 3;
  const evaluated = commits.map((c) => evaluateCommit(c, minScore));

  const candidates = evaluated
    .filter((c) => c.isCandidate)
    .sort((a, b) => b.score - a.score);

  const noiseFiltered = evaluated.filter((c) => !c.isCandidate);

  return {
    totalInspected: commits.length,
    candidates,
    noiseFiltered,
  };
}

/**
 * Formats discovered candidates into a clear, readable terminal summary.
 */
export function formatCandidateSummary(
  result: DiscoveryResult,
  verbose = false
): string {
  const lines: string[] = [];

  lines.push(`[TypeBench] Candidate discovery...`);
  lines.push(`[TypeBench] Candidates found: ${result.candidates.length}`);
  lines.push(`[TypeBench] Noise filtered: ${result.noiseFiltered.length}\n`);

  if (result.candidates.length === 0) {
    lines.push('  (No candidate benchmark commits discovered)');
    return lines.join('\n');
  }

  lines.push('Top candidates:\n');

  result.candidates.forEach((candidate, index) => {
    const subject = candidate.message.split('\n')[0];
    const signalSummary = candidate.signals.positive
      .map((s) => s.split(' ')[0])
      .slice(0, 4)
      .join(', ');

    if (!verbose) {
      lines.push(`${index + 1}. ${candidate.shortSha}`);
      lines.push(`   ${subject}`);
      lines.push(`   Category: ${candidate.category}`);
      lines.push(`   Score: ${candidate.score}`);
      lines.push(`   Signals: ${signalSummary || 'none'}\n`);
    } else {
      lines.push(`----------------------------------------`);
      lines.push(`[Candidate #${index + 1}]`);
      lines.push(`SHA: ${candidate.sha}`);
      lines.push(`Parent: ${candidate.parentSha || 'None (root/shallow boundary)'}`);
      lines.push(`Message: ${subject}`);
      lines.push(`Category: ${candidate.category}`);
      lines.push(`Score: ${candidate.score}`);
      lines.push(`Date: ${candidate.date}`);
      lines.push(`Author: ${candidate.author} <${candidate.authorEmail}>`);
      lines.push(`\nPositive signals:`);
      if (candidate.signals.positive.length > 0) {
        candidate.signals.positive.forEach((s) => lines.push(`  + ${s}`));
      } else {
        lines.push(`  (none)`);
      }
      lines.push(`Negative signals:`);
      if (candidate.signals.negative.length > 0) {
        candidate.signals.negative.forEach((s) => lines.push(`  - ${s}`));
      } else {
        lines.push(`  (none)`);
      }
      lines.push(`\nFiles Overview:`);
      lines.push(`  Source Files (${candidate.sourceFiles.length}): ${candidate.sourceFiles.slice(0, 4).join(', ')}${candidate.sourceFiles.length > 4 ? '...' : ''}`);
      lines.push(`  Test Files   (${candidate.testFiles.length}): ${candidate.testFiles.slice(0, 4).join(', ')}${candidate.testFiles.length > 4 ? '...' : ''}`);
      lines.push(`  Doc Files    (${candidate.docFiles.length}): ${candidate.docFiles.slice(0, 3).join(', ')}`);
      lines.push(``);
    }
  });

  return lines.join('\n');
}
