/**
 * TypeBench Git History Discovery Utility
 * Inspects a repository's Git history and extracts structured commit metadata.
 */

import * as fs from 'node:fs';
import { simpleGit, SimpleGit } from 'simple-git';

export interface CommitStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedFiles: string[];
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  parentSha: string | null;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  changedFiles?: string[];
}

export interface HistoryOptions {
  depth?: number;
  verbose?: boolean;
}

export interface HistoryResult {
  success: boolean;
  commits: CommitInfo[];
  totalDiscovered: number;
  isShallow: boolean;
  warning?: string;
  error?: string;
}

/**
 * Extracts file change statistics (filesChanged, insertions, deletions) for a commit.
 */
async function getCommitStats(git: SimpleGit, commitSha: string): Promise<CommitStats> {
  try {
    const rawNumstat = await git.raw(['show', '--numstat', '--format=', commitSha]);
    const lines = rawNumstat.split('\n').map((l) => l.trim()).filter(Boolean);

    let insertions = 0;
    let deletions = 0;
    const changedFiles: string[] = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const added = parseInt(parts[0], 10);
        const deleted = parseInt(parts[1], 10);
        const fileName = parts.slice(2).join(' ');

        if (!isNaN(added)) insertions += added;
        if (!isNaN(deleted)) deletions += deleted;
        changedFiles.push(fileName);
      }
    }

    return {
      filesChanged: changedFiles.length,
      insertions,
      deletions,
      changedFiles,
    };
  } catch {
    return {
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      changedFiles: [],
    };
  }
}

/**
 * Retrieves the parent commit SHA of a given commit, or null if none exist.
 */
async function getParentSha(git: SimpleGit, commitSha: string): Promise<string | null> {
  try {
    const rawParents = await git.raw(['log', '-1', '--format=%P', commitSha]);
    const parents = rawParents.trim().split(/\s+/).filter(Boolean);
    return parents.length > 0 ? parents[0] : null;
  } catch {
    return null;
  }
}

/**
 * Discovers and parses Git commit history from a cloned repository workspace.
 */
export async function discoverGitHistory(
  workspacePath: string,
  options: HistoryOptions = {}
): Promise<HistoryResult> {
  const requestedDepth = options.depth ?? 20;

  if (!fs.existsSync(workspacePath)) {
    return {
      success: false,
      commits: [],
      totalDiscovered: 0,
      isShallow: false,
      error: `Workspace directory not found: ${workspacePath}`,
    };
  }

  const git: SimpleGit = simpleGit(workspacePath);

  // 1. Verify this is a valid Git repository
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        success: false,
        commits: [],
        totalDiscovered: 0,
        isShallow: false,
        error: `Directory is not a valid Git repository: ${workspacePath}`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      commits: [],
      totalDiscovered: 0,
      isShallow: false,
      error: `Failed to inspect Git repository: ${err?.message || String(err)}`,
    };
  }

  // 2. Check if repository is shallow
  let isShallow = false;
  try {
    const shallowOutput = (await git.raw(['rev-parse', '--is-shallow-repository'])).trim();
    isShallow = shallowOutput === 'true';
  } catch {
    isShallow = false;
  }

  // 3. Retrieve commit log
  let logResult;
  try {
    logResult = await git.log({ maxCount: requestedDepth });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('does not have any commits') || errMsg.includes('fatal: your current branch')) {
      return {
        success: true,
        commits: [],
        totalDiscovered: 0,
        isShallow,
        warning: 'Repository has no commits on the active branch.',
      };
    }
    return {
      success: false,
      commits: [],
      totalDiscovered: 0,
      isShallow,
      error: `Failed to read Git history: ${errMsg}`,
    };
  }

  if (!logResult || !logResult.all || logResult.all.length === 0) {
    return {
      success: true,
      commits: [],
      totalDiscovered: 0,
      isShallow,
      warning: 'No commits found in the repository.',
    };
  }

  // 4. Enrich commit information with parent SHA and file stats
  const commits: CommitInfo[] = [];

  for (const rawCommit of logResult.all) {
    const sha = rawCommit.hash;
    const shortSha = sha.slice(0, 7);
    const message = rawCommit.message.trim();
    const author = rawCommit.author_name;
    const authorEmail = rawCommit.author_email;
    const date = rawCommit.date;

    const [parentSha, stats] = await Promise.all([
      getParentSha(git, sha),
      getCommitStats(git, sha),
    ]);

    commits.push({
      sha,
      shortSha,
      message,
      author,
      authorEmail,
      date,
      parentSha,
      filesChanged: stats.filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
      changedFiles: stats.changedFiles,
    });
  }

  let warning: string | undefined;
  if (isShallow && commits.length < requestedDepth) {
    warning = `[TypeBench] Available history is limited by shallow clone depth (${commits.length} commits available, ${requestedDepth} requested).`;
  }

  return {
    success: true,
    commits,
    totalDiscovered: commits.length,
    isShallow,
    warning,
  };
}

/**
 * Formats a list of commits into a readable terminal summary.
 */
export function formatCommitSummary(commits: CommitInfo[], verbose = false): string {
  if (commits.length === 0) {
    return '  (No commits discovered)';
  }

  return commits
    .map((commit, index) => {
      const header = `[TypeBench] ${index + 1}. ${commit.shortSha}`;
      const msgLines = commit.message.split('\n');
      const subject = msgLines[0];
      const stats = `Files changed: ${commit.filesChanged ?? 0}\n             +${commit.insertions ?? 0} / -${commit.deletions ?? 0}`;
      const dateFormatted = commit.date.slice(0, 10);

      if (!verbose) {
        return `${header}\n             ${subject}\n             ${dateFormatted}\n             ${stats}`;
      }

      // Verbose format with author, email, full SHA, parent SHA, and modified files
      const fullSha = `SHA: ${commit.sha}`;
      const parent = `Parent: ${commit.parentSha || 'None (root/shallow boundary)'}`;
      const author = `Author: ${commit.author} <${commit.authorEmail}>`;
      const dateFull = `Date: ${commit.date}`;
      const body = msgLines.length > 1 ? `\n             Body: ${msgLines.slice(1).join(' ').trim()}` : '';
      const files =
        commit.changedFiles && commit.changedFiles.length > 0
          ? `\n             Modified Files:\n${commit.changedFiles.slice(0, 8).map((f) => `               - ${f}`).join('\n')}${commit.changedFiles.length > 8 ? `\n               ... and ${commit.changedFiles.length - 8} more files` : ''}`
          : '';

      return `${header} (${fullSha})\n             ${subject}${body}\n             ${author}\n             ${dateFull}\n             ${parent}\n             ${stats}${files}`;
    })
    .join('\n\n');
}
