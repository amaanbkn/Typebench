/**
 * Typebench Leaderboard Generator
 * Parses run logs from results/runs/ and generates aggregated leaderboard rankings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface BenchmarkRunRecord {
  releaseVersion: string;
  agentName: string;
  totalTasks: number;
  solvedTasks: number;
  totalDurationMs: number;
}

interface AgentStats {
  agentName: string;
  agentType: 'model-backed' | 'heuristic';
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgDurationSec: number;
}

export function generateLeaderboard(releaseVersion = '0.2.0'): AgentStats[] {
  console.log('⚡ Generating Typebench Leaderboard...');
  const version = releaseVersion.replace(/^v/, '');
  const releasePath = releaseVersion.endsWith('.json')
    ? path.resolve(process.cwd(), releaseVersion)
    : path.resolve(process.cwd(), 'dataset/releases', `v${version}.json`);
  if (!fs.existsSync(releasePath)) {
    throw new Error(`Release checkpoint not found: ${releasePath}`);
  }
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf-8')) as {
    totalTasks: number;
    version: string;
  };
  const benchmarkRunsDir = path.resolve(process.cwd(), 'results/benchmark-runs');
  const reports: BenchmarkRunRecord[] = [];

  let skippedReports = 0;
  if (fs.existsSync(benchmarkRunsDir)) {
    const files = fs.readdirSync(benchmarkRunsDir).filter((file) => file.endsWith('.json'));
    console.log(`Found ${files.length} benchmark run report(s) in ${benchmarkRunsDir}.`);

    for (const file of files) {
      try {
        const report = JSON.parse(
          fs.readFileSync(path.join(benchmarkRunsDir, file), 'utf-8'),
        ) as BenchmarkRunRecord;
        if (
          report.releaseVersion === release.version &&
          report.totalTasks === release.totalTasks &&
          report.agentName !== 'mock' &&
          report.agentName !== 'nemotron' &&
          typeof report.agentName === 'string' &&
          Number.isFinite(report.totalTasks) &&
          Number.isFinite(report.solvedTasks) &&
          Number.isFinite(report.totalDurationMs)
        ) {
          reports.push(report);
        } else {
          skippedReports++;
        }
      } catch (error) {
        console.warn(`Failed to parse benchmark report ${file}: ${String(error)}`);
      }
    }
  }
  console.log(
    `Included ${reports.length} complete release report(s); skipped ${skippedReports} partial, other-release, or test-only report(s).`,
  );

  if (reports.length > 0) {
    const agentMap = new Map<string, { total: number; passed: number; totalDuration: number }>();
    for (const report of reports) {
      const current = agentMap.get(report.agentName) || { total: 0, passed: 0, totalDuration: 0 };
      current.total += report.totalTasks;
      current.passed += report.solvedTasks;
      current.totalDuration += report.totalDurationMs;
      agentMap.set(report.agentName, current);
    }

    const stats: AgentStats[] = Array.from(agentMap.entries()).map(([agentName, data]) => ({
      agentName,
      agentType: agentName === 'ts-solver' ? 'heuristic' : 'model-backed',
      totalTasks: data.total,
      passedTasks: data.passed,
      passRate: data.total > 0 ? (data.passed / data.total) * 100 : 0,
      avgDurationSec: data.total > 0 ? (data.totalDuration / data.total) / 1000 : 0,
    }));

    stats.sort((a, b) => b.passRate - a.passRate);
    console.table(stats);
    return stats;
  }

  console.log(`No complete, comparable, non-mock runs found for release v${release.version}.`);
  return [];
}

if (process.argv[1]?.includes('generate')) {
  const releaseIndex = process.argv.indexOf('--release');
  generateLeaderboard(releaseIndex >= 0 ? process.argv[releaseIndex + 1] : '0.2.0');
}
