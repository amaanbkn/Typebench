/**
 * TypeBench Task Quality Management & Filtering Engine
 * Evaluates candidate tasks against strict quality gates prioritizing quality over quantity.
 */

import { ScoredCandidate } from '../scripts/candidate-discovery.js';
import { ValidationReport } from '../scripts/validate-candidate.js';

export interface QualityCriteria {
  minScore?: number; // default: 8
  maxFilesChanged?: number; // default: 10
  minFilesChanged?: number; // default: 1
  maxLinesChanged?: number; // default: 500
  requireTypeScript?: boolean; // default: true
}

export interface QualityEvaluation {
  passed: boolean;
  score: number;
  reasons: string[];
  category: 'type_system' | 'bug_fix' | 'feature' | 'refactor' | 'api_design';
  difficulty: 'easy' | 'medium' | 'hard';
}

const DEFAULT_CRITERIA: Required<QualityCriteria> = {
  minScore: 8,
  maxFilesChanged: 10,
  minFilesChanged: 1,
  maxLinesChanged: 500,
  requireTypeScript: true,
};

/**
 * Assesses whether a candidate commit meets TypeBench dataset quality standards.
 */
export function evaluateQuality(
  candidate: ScoredCandidate,
  validationReport?: ValidationReport,
  criteria: QualityCriteria = {}
): QualityEvaluation {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const reasons: string[] = [];
  let passed = true;

  // 1. Candidate Score Threshold
  if (candidate.score < c.minScore) {
    passed = false;
    reasons.push(`Score ${candidate.score} below minimum threshold (${c.minScore})`);
  }

  // 2. Atomic Changes Bounds
  const fileList = candidate.changedFiles || [
    ...(candidate.sourceFiles || []),
    ...(candidate.testFiles || []),
    ...(candidate.docFiles || []),
    ...(candidate.configFiles || []),
  ];
  const filesCount = typeof candidate.filesChanged === 'number' ? candidate.filesChanged : fileList.length;

  if (filesCount < c.minFilesChanged || filesCount > c.maxFilesChanged) {
    passed = false;
    reasons.push(`Changed files count (${filesCount}) outside atomic bounds [${c.minFilesChanged}, ${c.maxFilesChanged}]`);
  }

  // 3. TypeScript Ecosystem Relevance
  const hasTsFiles = fileList.some(
    (f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.d.ts')
  );
  if (c.requireTypeScript && !hasTsFiles) {
    passed = false;
    reasons.push('No TypeScript (.ts/.tsx/.d.ts) source files modified in candidate');
  }

  // 4. Line Diff Volume
  const totalLines = (candidate.insertions || 0) + (candidate.deletions || 0);
  if (totalLines > c.maxLinesChanged) {
    passed = false;
    reasons.push(`Diff volume (${totalLines} lines) exceeds maximum limit (${c.maxLinesChanged})`);
  }

  // 5. Validation Check (if available)
  if (validationReport && validationReport.status === 'invalid') {
    passed = false;
    reasons.push(`Candidate validation marked as invalid: ${validationReport.validationReason}`);
  }

  // Determine Categorization
  let category: QualityEvaluation['category'] = 'bug_fix';
  const msg = candidate.message.toLowerCase();
  const positiveSignals = Array.isArray(candidate.signals)
    ? candidate.signals
    : candidate.signals?.positive || [];

  if (
    positiveSignals.includes('type_definition_change') ||
    positiveSignals.includes('type_inference_keyword') ||
    msg.includes('type')
  ) {
    category = 'type_system';
  } else if (msg.includes('feat') || msg.includes('add') || positiveSignals.includes('feature_keyword')) {
    category = 'feature';
  } else if (msg.includes('refactor') || msg.includes('clean')) {
    category = 'refactor';
  } else if (msg.includes('api') || msg.includes('route') || msg.includes('endpoint')) {
    category = 'api_design';
  }

  // Determine Difficulty
  let difficulty: QualityEvaluation['difficulty'] = 'medium';
  if (candidate.score >= 12 || filesCount >= 5 || totalLines >= 150) {
    difficulty = 'hard';
  } else if (candidate.score <= 8 && filesCount <= 2 && totalLines <= 30) {
    difficulty = 'easy';
  }

  return {
    passed,
    score: candidate.score,
    reasons,
    category,
    difficulty,
  };
}
