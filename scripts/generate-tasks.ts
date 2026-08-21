/**
 * TypeBench Task Generator Entrypoint (Step 2: Repository Cloning & Git History Discovery)
 *
 * Usage:
 *   npx tsx scripts/generate-tasks.ts --repo <name> [--history-depth <n>] [--verbose]
 */

import { cloneRepository, getSeedRepos } from './clone-repo.js';
import { discoverGitHistory, formatCommitSummary } from './git-history.js';

async function main() {
  const args = process.argv.slice(2);
  let repoQuery: string | undefined;
  let cloneDepth: number | undefined;
  let historyDepth = 20;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' || arg === '-r') {
      repoQuery = args[++i];
    } else if (arg === '--history-depth') {
      historyDepth = parseInt(args[++i], 10);
    } else if (arg === '--clone-depth') {
      cloneDepth = parseInt(args[++i], 10);
    } else if (arg === '--depth' || arg === '-d') {
      historyDepth = parseInt(args[++i], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench - Git History Discovery

Usage:
  npx tsx scripts/generate-tasks.ts --repo <name> [--history-depth <n>] [--verbose]

Options:
  -r, --repo <name>             Repository name from seed-repos.json or URL (e.g. trpc, zod, prisma, hono, type-challenges)
  -d, --history-depth <n>       Number of commits to discover (default: 20)
  --clone-depth <n>             Initial shallow clone depth (default: matches history-depth)
  -v, --verbose                 Show detailed commit information (author, parent SHA, full commit message, files list)
  -h, --help                    Show help

Available repositories in seed-repos.json:
${getSeedRepos().map((r) => `  - ${r.name} (${r.url})`).join('\n')}
`);
      process.exit(0);
    } else if (!arg.startsWith('-') && !repoQuery) {
      repoQuery = arg;
    }
  }

  if (!repoQuery) {
    console.error('Error: Please specify a repository using --repo <name>');
    console.log('Available seed repositories: trpc, zod, prisma, hono, type-challenges');
    process.exit(1);
  }

  // 1. Clone repository into temporary isolated workspace
  const cloneResult = await cloneRepository(repoQuery, { depth: cloneDepth ?? historyDepth });
  if (!cloneResult.success || !cloneResult.workspacePath) {
    process.exit(1);
  }

  // 2. Discover Git history
  console.log('\n[TypeBench] Discovering Git history...\n');
  const historyResult = await discoverGitHistory(cloneResult.workspacePath, {
    depth: historyDepth,
    verbose,
  });

  if (!historyResult.success) {
    console.error(`[TypeBench] Error reading Git history: ${historyResult.error}`);
    process.exit(1);
  }

  if (historyResult.warning) {
    console.log(historyResult.warning);
  }

  console.log(`[TypeBench] Commits discovered: ${historyResult.totalDiscovered}\n`);

  // 3. Display formatted summary of commits
  console.log(formatCommitSummary(historyResult.commits, verbose));
}

if (process.argv[1]?.includes('generate-tasks')) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
