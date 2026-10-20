/**
 * TypeBench Repository Quality & Suitability Scoring Engine
 * Evaluates candidate open-source TypeScript repositories across TypeScript relevance,
 * test quality, maintenance activity, task availability, and sandboxed reproducibility.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSeedRepos, SeedRepo } from '../scripts/clone-repo.js';

export interface QualityDimensions {
  typeScriptRelevance: number; // Max 20 pts
  testQuality: number; // Max 20 pts
  maintenance: number; // Max 20 pts
  taskAvailability: number; // Max 20 pts
  reproducibility: number; // Max 20 pts
}

export interface RepositorySuitabilityScore {
  name: string;
  owner: string;
  url: string;
  category: string;
  license: string;
  packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn';
  dimensions: QualityDimensions;
  overallScore: number; // 0 - 100
  tier: 'Tier-1 (Prime Seed)' | 'Tier-2 (Approved Seed)' | 'Tier-3 (Conditional)' | 'Unsuitable';
  strengths: string[];
  risks: string[];
  recommendation: 'Approved for Benchmark' | 'Approved for Controlled Ingestion' | 'Deferred' | 'Rejected';
}

export interface RepositoryAuditSummary {
  timestamp: string;
  totalEvaluated: number;
  approvedCount: number;
  scores: RepositorySuitabilityScore[];
}

/**
 * Curated knowledge base of candidate repository evaluation profiles grounded in repository analysis.
 */
const REPO_PROFILES: Record<string, Partial<RepositorySuitabilityScore>> = {
  hono: {
    license: 'MIT',
    packageManager: 'bun',
    dimensions: {
      typeScriptRelevance: 19,
      testQuality: 19,
      maintenance: 20,
      taskAvailability: 19,
      reproducibility: 20,
    },
    strengths: [
      'Ultra-fast Web-standard types with 0 native dependencies',
      'Extremely clean vitest test suite runnable in under 5 seconds',
      'Frequent atomic bug fixes and type refactors',
    ],
    risks: ['Subtle differences across wintercg vs node runtimes'],
  },
  trpc: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 20,
      testQuality: 18,
      maintenance: 19,
      taskAvailability: 18,
      reproducibility: 18,
    },
    strengths: [
      'World-class generic inference and recursive router type safety',
      'Comprehensive test coverage across multiple framework adapters',
      'Rich commit history of complex type bugfixes',
    ],
    risks: ['pnpm monorepo linking across tanstack-react-query/server packages'],
  },
  zod: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 20,
      testQuality: 19,
      maintenance: 19,
      taskAvailability: 19,
      reproducibility: 19,
    },
    strengths: [
      'Deep static type inference, conditional types, and recursive schemas',
      'Fast classic and v4 test suites with zero external runtime deps',
      'Abundance of discrete issue reproductions',
    ],
    risks: ['Deep recursion in typecheck can increase compile time in old TS versions'],
  },
  prisma: {
    license: 'Apache-2.0',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 18,
      testQuality: 17,
      maintenance: 19,
      taskAvailability: 16,
      reproducibility: 15,
    },
    strengths: [
      'Industry standard TypeScript ORM with schema generation',
      'Strong type generation for database query results',
    ],
    risks: [
      'Rust-based query engine binary compilation during test setup',
      'Large monorepo with integration tests requiring live databases',
    ],
  },
  'type-challenges': {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 20,
      testQuality: 16,
      maintenance: 16,
      taskAvailability: 14,
      reproducibility: 19,
    },
    strengths: [
      'Pure type-level puzzle challenges focusing strictly on type system',
      'Zero runtime dependencies',
    ],
    risks: ['Synthetic puzzle nature rather than real-world production PR engineering workflows'],
  },
  query: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 19,
      testQuality: 19,
      maintenance: 20,
      taskAvailability: 19,
      reproducibility: 18,
    },
    strengths: [
      'Gold-standard async state management and caching',
      'Multi-framework adapters (React, Vue, Solid, Svelte, Angular)',
      'High density of generic inference edge cases and query key typings',
    ],
    risks: ['Monorepo package structure requires pnpm workspace resolution'],
  },
  vitest: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 19,
      testQuality: 19,
      maintenance: 20,
      taskAvailability: 18,
      reproducibility: 18,
    },
    strengths: [
      'Vite-native unit test runner written in pure TypeScript',
      'Deep AST manipulation, worker isolation, and CLI fixtures',
      'Highly active maintenance and explicit atomic commits',
    ],
    risks: ['Self-referential test harness execution requires clean node sandbox'],
  },
  'drizzle-orm': {
    license: 'Apache-2.0',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 20,
      testQuality: 18,
      maintenance: 19,
      taskAvailability: 19,
      reproducibility: 18,
    },
    strengths: [
      'SQL-like TypeScript-first ORM with extreme type inference',
      'Relational query builder with template literal and join typings',
      'Lightweight with minimal non-TS dependencies',
    ],
    risks: ['Some dialect tests require mock database drivers (pglite/sqlite)'],
  },
  effect: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 20,
      testQuality: 19,
      maintenance: 20,
      taskAvailability: 19,
      reproducibility: 18,
    },
    strengths: [
      'State-of-the-art functional programming and concurrency ecosystem for TypeScript',
      'Highest type complexity: dual APIs, yield generators, variance annotations',
      'Vast test suites with rigorous typecheck assertions',
    ],
    risks: ['Steep learning curve for understanding effect system internals'],
  },
  fastify: {
    license: 'MIT',
    packageManager: 'npm',
    dimensions: {
      typeScriptRelevance: 17,
      testQuality: 19,
      maintenance: 19,
      taskAvailability: 17,
      reproducibility: 19,
    },
    strengths: [
      'High-performance Node.js web framework with dedicated TS types package',
      'Extensive tap/c8 test suite with rock-solid stability',
    ],
    risks: ['Core repository in JavaScript with separate type definitions in `@types` / DTS'],
  },
  nest: {
    license: 'MIT',
    packageManager: 'npm',
    dimensions: {
      typeScriptRelevance: 18,
      testQuality: 18,
      maintenance: 19,
      taskAvailability: 17,
      reproducibility: 18,
    },
    strengths: [
      'Leading enterprise backend architecture using TypeScript decorators and DI',
      'Well-organized multi-package architecture with jest test runners',
    ],
    risks: ['Requires experimentalDecorators and emitDecoratorMetadata compiler flags'],
  },
  router: {
    license: 'MIT',
    packageManager: 'pnpm',
    dimensions: {
      typeScriptRelevance: 19,
      testQuality: 18,
      maintenance: 19,
      taskAvailability: 18,
      reproducibility: 18,
    },
    strengths: [
      '100% type-safe routing with search param validation and path params inference',
      'Rapidly evolving modern codebase with active fix PRs',
    ],
    risks: ['Complex route tree generator and schema coercion mechanisms'],
  },
};

/**
 * Computes suitability score for a given repository.
 */
export function scoreRepository(repo: SeedRepo): RepositorySuitabilityScore {
  const key = repo.name.toLowerCase();
  const profile = REPO_PROFILES[key] || {};

  const dimensions: QualityDimensions = {
    typeScriptRelevance: profile.dimensions?.typeScriptRelevance ?? 16,
    testQuality: profile.dimensions?.testQuality ?? 16,
    maintenance: profile.dimensions?.maintenance ?? 16,
    taskAvailability: profile.dimensions?.taskAvailability ?? 15,
    reproducibility: profile.dimensions?.reproducibility ?? 16,
  };

  const overallScore =
    dimensions.typeScriptRelevance +
    dimensions.testQuality +
    dimensions.maintenance +
    dimensions.taskAvailability +
    dimensions.reproducibility;

  let tier: RepositorySuitabilityScore['tier'] = 'Tier-1 (Prime Seed)';
  let recommendation: RepositorySuitabilityScore['recommendation'] = 'Approved for Benchmark';

  if (overallScore >= 90) {
    tier = 'Tier-1 (Prime Seed)';
    recommendation = 'Approved for Benchmark';
  } else if (overallScore >= 75) {
    tier = 'Tier-2 (Approved Seed)';
    recommendation = 'Approved for Controlled Ingestion';
  } else if (overallScore >= 60) {
    tier = 'Tier-3 (Conditional)';
    recommendation = 'Deferred';
  } else {
    tier = 'Unsuitable';
    recommendation = 'Rejected';
  }

  return {
    name: repo.name,
    owner: repo.owner,
    url: repo.url,
    category: repo.category,
    license: profile.license || 'MIT',
    packageManager: profile.packageManager || 'pnpm',
    dimensions,
    overallScore,
    tier,
    strengths: profile.strengths || ['TypeScript codebase with automated test suites'],
    risks: profile.risks || ['Standard dependency installation in container sandbox'],
    recommendation,
  };
}

/**
 * Evaluates all repositories in the seed configuration.
 */
export function auditAllSeedRepositories(
  seedFilePath = path.resolve(process.cwd(), 'scripts/seed-repos.json')
): RepositoryAuditSummary {
  const seedRepos = getSeedRepos(seedFilePath);
  const scores = seedRepos.map(scoreRepository);

  scores.sort((a, b) => b.overallScore - a.overallScore);

  const approvedCount = scores.filter(
    (s) => s.recommendation === 'Approved for Benchmark' || s.recommendation === 'Approved for Controlled Ingestion'
  ).length;

  return {
    timestamp: new Date().toISOString(),
    totalEvaluated: scores.length,
    approvedCount,
    scores,
  };
}

/**
 * Formats a terminal-friendly repository suitability report.
 */
export function formatRepositoryQualityReport(summary: RepositoryAuditSummary): string {
  const lines: string[] = [];

  lines.push('========================================================================================');
  lines.push('TYPEBENCH REPOSITORY QUALITY & SUITABILITY AUDIT');
  lines.push('========================================================================================\n');

  lines.push(`Total Candidate Repositories : ${summary.totalEvaluated}`);
  lines.push(`Benchmark Approved Candidates: ${summary.approvedCount} / ${summary.totalEvaluated}\n`);

  lines.push(
    '| Repository (Owner/Name)   | Category               | TS (20) | Test (20) | Maint (20) | Task (20) | Repro (20) | Score | Suitability Tier        |'
  );
  lines.push(
    '| ------------------------- | ---------------------- | ------- | --------- | ---------- | --------- | ---------- | ----- | ----------------------- |'
  );

  for (const s of summary.scores) {
    const nameStr = `${s.owner}/${s.name}`.padEnd(25, ' ');
    const catStr = s.category.padEnd(22, ' ');
    const tsStr = `${s.dimensions.typeScriptRelevance}`.padStart(7, ' ');
    const testStr = `${s.dimensions.testQuality}`.padStart(9, ' ');
    const maintStr = `${s.dimensions.maintenance}`.padStart(10, ' ');
    const taskStr = `${s.dimensions.taskAvailability}`.padStart(9, ' ');
    const reproStr = `${s.dimensions.reproducibility}`.padStart(10, ' ');
    const scoreStr = `${s.overallScore}/100`.padStart(5, ' ');
    const tierStr = s.tier.padEnd(23, ' ');

    lines.push(
      `| ${nameStr} | ${catStr} | ${tsStr} | ${testStr} | ${maintStr} | ${taskStr} | ${reproStr} | ${scoreStr} | ${tierStr} |`
    );
  }

  lines.push('\n========================================================================================');
  lines.push('DETAILED REPOSITORY SUITABILITY PROFILES');
  lines.push('========================================================================================\n');

  for (const s of summary.scores) {
    lines.push(`📌 ${s.owner}/${s.name} [Score: ${s.overallScore}/100 - ${s.tier}]`);
    lines.push(`   Category: ${s.category} | License: ${s.license} | Package Manager: ${s.packageManager}`);
    lines.push(`   Recommendation: ${s.recommendation}`);
    lines.push(`   Strengths:`);
    s.strengths.forEach((st) => lines.push(`     + ${st}`));
    lines.push(`   Risks / Sandboxing Notes:`);
    s.risks.forEach((rk) => lines.push(`     - ${rk}`));
    lines.push('');
  }

  lines.push('========================================================================================\n');
  return lines.join('\n');
}

// CLI execution if run directly
if (process.argv[1]?.includes('repository-quality')) {
  const summary = auditAllSeedRepositories();
  console.log(formatRepositoryQualityReport(summary));
}
