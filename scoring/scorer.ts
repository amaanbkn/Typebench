/**
 * TypeBench Deterministic Scoring Engine
 * Converts EvaluationResult records into standardized numerical scores based on
 * explicit component weighting (Benchmark tests: 70%, Typecheck: 15%, Regression: 15%).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvaluationResult } from '../evaluator/evaluator.js';

export type ScoreStatus =
  | 'solved'
  | 'failed'
  | 'no_changes'
  | 'timeout'
  | 'infrastructure_failure'
  | 'invalid_task';

export interface ScoreComponentDetail {
  weight: number;
  score: number;
  maxScore: number;
  status: string;
}

export interface ScoreComponents {
  benchmarkTests: ScoreComponentDetail;
  regressionTests: ScoreComponentDetail;
  typecheck: ScoreComponentDetail;
}

export interface ScoreResult {
  runId: string;
  taskId: string;
  agentName: string;
  score: number | null;
  maxScore: number;
  components: ScoreComponents;
  status: ScoreStatus;
  isAvailable: boolean;
  evaluationStatus: string;
  durationMs: number;
  timestamp: string;
}

export interface ScoreRunOptions {
  outputScoresDir?: string;
  verbose?: boolean;
}

export const SCORING_WEIGHTS = {
  BENCHMARK_TESTS: 70,
  TYPECHECK: 15,
  REGRESSION_TESTS: 15,
  MAX_SCORE: 100,
} as const;

/**
 * Computes deterministic score components and total score from an EvaluationResult.
 */
export function computeScore(evaluation: EvaluationResult): ScoreResult {
  const {
    runId,
    taskId,
    agentName,
    status: evalStatus,
    benchmarkTests,
    regressionTests,
    typecheck,
    durationMs,
  } = evaluation;

  // Handle Infrastructure Failures & Invalid Tasks (Score is unavailable, not penalizing agent)
  if (evalStatus === 'infrastructure_failure' || evalStatus === 'invalid_task') {
    return {
      runId,
      taskId,
      agentName,
      score: null,
      maxScore: SCORING_WEIGHTS.MAX_SCORE,
      components: {
        benchmarkTests: {
          weight: SCORING_WEIGHTS.BENCHMARK_TESTS,
          score: 0,
          maxScore: SCORING_WEIGHTS.BENCHMARK_TESTS,
          status: benchmarkTests?.status || 'unavailable',
        },
        regressionTests: {
          weight: SCORING_WEIGHTS.REGRESSION_TESTS,
          score: 0,
          maxScore: SCORING_WEIGHTS.REGRESSION_TESTS,
          status: regressionTests?.status || 'unavailable',
        },
        typecheck: {
          weight: SCORING_WEIGHTS.TYPECHECK,
          score: 0,
          maxScore: SCORING_WEIGHTS.TYPECHECK,
          status: typecheck?.status || 'unavailable',
        },
      },
      status: evalStatus as ScoreStatus,
      isAvailable: false,
      evaluationStatus: evalStatus,
      durationMs: durationMs || 0,
      timestamp: new Date().toISOString(),
    };
  }

  // Handle No-op changes and Timeouts
  if (evalStatus === 'no_changes' || evalStatus === 'timeout') {
    return {
      runId,
      taskId,
      agentName,
      score: 0,
      maxScore: SCORING_WEIGHTS.MAX_SCORE,
      components: {
        benchmarkTests: {
          weight: SCORING_WEIGHTS.BENCHMARK_TESTS,
          score: 0,
          maxScore: SCORING_WEIGHTS.BENCHMARK_TESTS,
          status: evalStatus,
        },
        regressionTests: {
          weight: SCORING_WEIGHTS.REGRESSION_TESTS,
          score: 0,
          maxScore: SCORING_WEIGHTS.REGRESSION_TESTS,
          status: evalStatus,
        },
        typecheck: {
          weight: SCORING_WEIGHTS.TYPECHECK,
          score: 0,
          maxScore: SCORING_WEIGHTS.TYPECHECK,
          status: evalStatus,
        },
      },
      status: evalStatus as ScoreStatus,
      isAvailable: true,
      evaluationStatus: evalStatus,
      durationMs: durationMs || 0,
      timestamp: new Date().toISOString(),
    };
  }

  // 1. Benchmark Component (70% weight)
  const isBenchmarkPassed = Boolean(benchmarkTests && benchmarkTests.passed);
  const benchmarkScore = isBenchmarkPassed ? SCORING_WEIGHTS.BENCHMARK_TESTS : 0;

  // 2. Typecheck Component (15% weight)
  let typecheckScore = 0;
  let typecheckStatus = 'unavailable';

  if (typecheck) {
    typecheckStatus = typecheck.status;
    if (typecheck.passed) {
      typecheckScore = SCORING_WEIGHTS.TYPECHECK;
    } else if (typecheck.status === 'unavailable' || typecheck.status === 'skipped') {
      // If typecheck was unavailable in repository, allocate points if benchmark passed
      typecheckScore = isBenchmarkPassed ? SCORING_WEIGHTS.TYPECHECK : 0;
    }
  } else {
    // If not configured, allocate points if benchmark passed
    typecheckScore = isBenchmarkPassed ? SCORING_WEIGHTS.TYPECHECK : 0;
  }

  // 3. Regression Component (15% weight)
  let regressionScore = 0;
  let regressionStatus = 'unavailable';

  if (regressionTests) {
    regressionStatus = regressionTests.status;
    if (regressionTests.passed) {
      regressionScore = SCORING_WEIGHTS.REGRESSION_TESTS;
    } else if (regressionTests.status === 'unavailable' || regressionTests.status === 'skipped') {
      regressionScore = isBenchmarkPassed ? SCORING_WEIGHTS.REGRESSION_TESTS : 0;
    }
  } else {
    regressionScore = isBenchmarkPassed ? SCORING_WEIGHTS.REGRESSION_TESTS : 0;
  }

  // Benchmark correctness is the gating factor: if benchmark failed, score cannot exceed 0
  let totalScore = isBenchmarkPassed ? benchmarkScore + typecheckScore + regressionScore : 0;

  // Enforce boundary invariants
  totalScore = Math.max(0, Math.min(SCORING_WEIGHTS.MAX_SCORE, totalScore));

  const finalStatus: ScoreStatus = isBenchmarkPassed && totalScore === SCORING_WEIGHTS.MAX_SCORE ? 'solved' : 'failed';

  return {
    runId,
    taskId,
    agentName,
    score: totalScore,
    maxScore: SCORING_WEIGHTS.MAX_SCORE,
    components: {
      benchmarkTests: {
        weight: SCORING_WEIGHTS.BENCHMARK_TESTS,
        score: benchmarkScore,
        maxScore: SCORING_WEIGHTS.BENCHMARK_TESTS,
        status: benchmarkTests?.status || (isBenchmarkPassed ? 'passed' : 'failed'),
      },
      regressionTests: {
        weight: SCORING_WEIGHTS.REGRESSION_TESTS,
        score: regressionScore,
        maxScore: SCORING_WEIGHTS.REGRESSION_TESTS,
        status: regressionStatus,
      },
      typecheck: {
        weight: SCORING_WEIGHTS.TYPECHECK,
        score: typecheckScore,
        maxScore: SCORING_WEIGHTS.TYPECHECK,
        status: typecheckStatus,
      },
    },
    status: finalStatus,
    isAvailable: true,
    evaluationStatus: evalStatus,
    durationMs: durationMs || 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Loads an evaluation report from results/evaluations/<runId>/evaluation.json
 */
export function loadEvaluation(evaluationPathOrRunId: string): EvaluationResult {
  let resolvedPath = path.resolve(process.cwd(), evaluationPathOrRunId);

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    resolvedPath = path.join(resolvedPath, 'evaluation.json');
  } else if (!fs.existsSync(resolvedPath)) {
    // Check in results/evaluations/
    const candidatePath = path.resolve(
      process.cwd(),
      'results/evaluations',
      evaluationPathOrRunId,
      'evaluation.json'
    );
    if (fs.existsSync(candidatePath)) {
      resolvedPath = candidatePath;
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Evaluation file not found at: ${resolvedPath}`);
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
}

/**
 * Scores an evaluation and saves the resulting score artifact under results/scores/<run-id>/score.json.
 */
export function scoreRun(
  evaluationPathOrRunId: string,
  options: ScoreRunOptions = {}
): ScoreResult {
  const evaluation = loadEvaluation(evaluationPathOrRunId);
  const scoreResult = computeScore(evaluation);

  const scoresBaseDir =
    options.outputScoresDir ?? path.resolve(process.cwd(), 'results/scores');
  const runScoreDir = path.join(scoresBaseDir, scoreResult.runId);

  fs.mkdirSync(runScoreDir, { recursive: true });
  fs.writeFileSync(
    path.join(runScoreDir, 'score.json'),
    JSON.stringify(scoreResult, null, 2),
    'utf-8'
  );

  if (options.verbose) {
    console.log(`[Scorer] Score saved to: ${runScoreDir}/score.json`);
  }

  return scoreResult;
}
