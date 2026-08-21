/**
 * TypeBench Repository Cloning Utility
 * Clones seed repositories into isolated temporary workspaces for benchmark execution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { simpleGit, SimpleGit } from 'simple-git';

export interface SeedRepo {
  owner: string;
  name: string;
  url: string;
  category: string;
  description: string;
  tags: string[];
}

export interface CloneOptions {
  depth?: number;
  tempDir?: string;
  cleanExisting?: boolean;
  branch?: string;
}

export interface CloneResult {
  success: boolean;
  repoName: string;
  repoUrl: string;
  workspacePath: string;
  commitHash?: string;
  error?: string;
}

/**
 * Loads and searches for a repository definition from seed-repos.json
 */
export function getSeedRepos(seedFilePath = path.resolve(process.cwd(), 'scripts/seed-repos.json')): SeedRepo[] {
  if (!fs.existsSync(seedFilePath)) {
    throw new Error(`Seed repositories file not found at: ${seedFilePath}`);
  }
  const raw = fs.readFileSync(seedFilePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Finds a repository in seed-repos.json by name or URL
 */
export function findSeedRepo(nameOrUrl: string, seedFilePath?: string): SeedRepo | undefined {
  const repos = getSeedRepos(seedFilePath);
  const query = nameOrUrl.trim().toLowerCase();

  return repos.find(
    (r) =>
      r.name.toLowerCase() === query ||
      r.owner.toLowerCase() === query ||
      `${r.owner}/${r.name}`.toLowerCase() === query ||
      r.url.toLowerCase() === query ||
      r.url.toLowerCase().endsWith(`/${query}`)
  );
}

/**
 * Clones a repository into an isolated temporary directory.
 */
export async function cloneRepository(
  repoNameOrUrl: string,
  options: CloneOptions = {}
): Promise<CloneResult> {
  const seedRepo = findSeedRepo(repoNameOrUrl);
  const repoName = seedRepo ? seedRepo.name : path.basename(repoNameOrUrl).replace(/\.git$/, '');
  const repoUrl = seedRepo ? seedRepo.url : repoNameOrUrl;

  const baseTempDir = options.tempDir ?? path.join(os.tmpdir(), 'typebench-workspaces');
  const uniqueWorkspaceId = `${repoName}-${Date.now().toString(36)}`;
  const workspacePath = path.join(baseTempDir, uniqueWorkspaceId);

  console.log(`[TypeBench] Repository: ${repoName}`);
  console.log(`[TypeBench] URL: ${repoUrl}`);
  console.log(`[TypeBench] Cloning...`);

  try {
    // Validate URL syntax before attempting git operations
    if (!repoUrl.startsWith('http://') && !repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
      throw new Error(`Invalid repository URL scheme: "${repoUrl}"`);
    }

    // Ensure parent temp directory exists
    fs.mkdirSync(baseTempDir, { recursive: true });

    // Clean up destination if cleanExisting is set and directory exists
    if (options.cleanExisting && fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    // Ensure git never prompts for credentials in automated runs
    process.env.GIT_TERMINAL_PROMPT = '0';
    process.env.GIT_ASKPASS = 'true';

    const git: SimpleGit = simpleGit();
    const cloneArgs: string[] = [];

    if (options.depth && options.depth > 0) {
      cloneArgs.push('--depth', String(options.depth));
    }
    if (options.branch) {
      cloneArgs.push('--branch', options.branch);
    }

    await git.clone(repoUrl, workspacePath, cloneArgs);

    // Verify workspace and retrieve current HEAD commit
    const workspaceGit = simpleGit(workspacePath);
    const headCommit = (await workspaceGit.raw(['rev-parse', 'HEAD'])).trim();

    console.log(`[TypeBench] Clone successful`);
    console.log(`[TypeBench] Workspace: ${workspacePath}`);

    return {
      success: true,
      repoName,
      repoUrl,
      workspacePath,
      commitHash: headCommit,
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    console.error(`[TypeBench] Clone failed: ${errorMessage}`);

    // Clean up partial directory if clone failed
    if (fs.existsSync(workspacePath)) {
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error on failure
      }
    }

    return {
      success: false,
      repoName,
      repoUrl,
      workspacePath,
      error: errorMessage,
    };
  }
}

/**
 * Cleans up a temporary cloned workspace directory.
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

// CLI Execution Handler
async function main() {
  const args = process.argv.slice(2);
  let repoQuery: string | undefined;
  let depth: number | undefined = 20;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' || arg === '-r') {
      repoQuery = args[++i];
    } else if (arg === '--depth' || arg === '-d') {
      depth = parseInt(args[++i], 10);
    } else if (arg === '--full') {
      depth = undefined;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeBench Repository Cloning Utility

Usage:
  npx tsx scripts/clone-repo.ts --repo <name|url> [--depth <n>]

Options:
  -r, --repo <name|url>  Repository name from seed-repos.json (e.g. trpc, zod, prisma, hono, type-challenges) or full URL
  -d, --depth <n>        Shallow clone depth (default: 20)
  --full                 Perform a full clone (no shallow limit)
  -h, --help             Show help
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

  const result = await cloneRepository(repoQuery, { depth });
  if (!result.success) {
    process.exit(1);
  }
}

if (process.argv[1]?.includes('clone-repo')) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
