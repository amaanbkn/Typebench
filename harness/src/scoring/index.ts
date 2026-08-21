/**
 * Scoring and Logging Engine
 * Evaluates test verification results, computes benchmark metrics, and saves run logs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScoreReport } from '../types.js';

export class BenchmarkScorer {
  private runsDir: string;

  constructor(runsDir = path.resolve(process.cwd(), 'results/runs')) {
    this.runsDir = runsDir;
  }

  /**
   * Records a benchmark run result and writes logs to results/runs/
   */
  async recordResult(report: ScoreReport): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${report.agentName}_${report.taskId}_${timestamp}.json`;
    const targetPath = path.join(this.runsDir, filename);

    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`[Scorer] Run result saved to: ${targetPath}`);
    return targetPath;
  }

  /**
   * Formats a terminal summary of the evaluation.
   */
  formatSummary(report: ScoreReport): string {
    const status = report.passed ? '✅ PASS' : '❌ FAIL';
    return `
========================================
Typebench Result Summary
----------------------------------------
Task ID    : ${report.taskId}
Agent      : ${report.agentName}
Status     : ${status}
Exit Code  : ${report.exitCode}
Duration   : ${(report.durationMs / 1000).toFixed(2)}s
Timestamp  : ${report.timestamp}
========================================`;
  }
}
