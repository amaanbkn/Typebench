/**
 * Typebench Leaderboard Generator
 * Parses run logs from results/runs/ and generates aggregated leaderboard rankings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScoreReport } from '../../harness/src/types.js';

interface AgentStats {
  agentName: string;
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgDurationSec: number;
}

export function generateLeaderboard(): AgentStats[] {
  console.log('⚡ Generating Typebench Leaderboard...');
  const runsDir = path.resolve(process.cwd(), 'results/runs');

  if (!fs.existsSync(runsDir)) {
    console.log('No runs directory found. Returning default placeholder stats.');
    return [];
  }

  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} run log files in ${runsDir}.`);

  const reports: ScoreReport[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(runsDir, file), 'utf-8');
      reports.push(JSON.parse(content));
    } catch (err) {
      console.warn(`Failed to parse run log: ${file}`);
    }
  }

  // Aggregate stats per agent
  const agentMap = new Map<string, { total: number; passed: number; totalDuration: number }>();
  for (const report of reports) {
    const current = agentMap.get(report.agentName) || { total: 0, passed: 0, totalDuration: 0 };
    current.total += 1;
    if (report.passed) current.passed += 1;
    current.totalDuration += report.durationMs;
    agentMap.set(report.agentName, current);
  }

  const stats: AgentStats[] = Array.from(agentMap.entries()).map(([agentName, data]) => ({
    agentName,
    totalTasks: data.total,
    passedTasks: data.passed,
    passRate: data.total > 0 ? (data.passed / data.total) * 100 : 0,
    avgDurationSec: data.total > 0 ? (data.totalDuration / data.total) / 1000 : 0,
  }));

  stats.sort((a, b) => b.passRate - a.passRate);

  console.table(stats);
  return stats;
}

if (process.argv[1]?.includes('generate')) {
  generateLeaderboard();
}
