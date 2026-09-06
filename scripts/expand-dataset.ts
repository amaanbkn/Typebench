/**
 * Dataset Expansion Script - USES EXECSYNC FOR GIT COMMANDS
 */
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

interface RepositoryConfig {
  name: string;
  url: string;
  category: string;
  testCommand: string;
  typecheckCommand: string;
}

interface CandidateCommit {
  hash: string;
  parentHash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  insertions: number;
  deletions: number;
  score: number;
  category: 'bugfix' | 'typefix' | 'feature' | 'regression' | 'test';
}

const TARGET_REPOS: RepositoryConfig[] = [
  { name: 'axios', url: 'https://github.com/axios/axios.git', category: 'http-client', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'rxjs', url: 'https://github.com/ReactiveX/rxjs.git', category: 'reactive', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'nestjs', url: 'https://github.com/nestjs/nest.git', category: 'backend-framework', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'vite', url: 'https://github.com/vitejs/vite.git', category: 'build-tool', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'typescript-eslint', url: 'https://github.com/typescript-eslint/typescript-eslint.git', category: 'linting', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'prisma', url: 'https://github.com/prisma/prisma.git', category: 'orm', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' },
  { name: 'type-challenges', url: 'https://github.com/type-challenges/type-challenges.git', category: 'type-exercises', testCommand: 'npm test', typecheckCommand: 'npm run typecheck' }
];

const QUALITY_THRESHOLDS = {
  minDiffLines: 3,
  maxDiffLines: 1000,
  maxFilesChanged: 20,
  minTypeScriptRatio: 0.3
};

async function ensureDirectories() {
  const dirs = ['./data', './data/repos', './data/tasks', './data/tasks/v0.2.0-candidates', './releases'];
  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }
  console.log(chalk.gray('✓ Directories ready'));
}

async function cloneRepo(repo: RepositoryConfig, basePath: string): Promise<string> {
  const repoPath = path.join(basePath, repo.name);
  
  if (await fs.pathExists(repoPath)) {
    await fs.remove(repoPath);
  }
  
  console.log(chalk.gray(`  Cloning ${repo.name}...`));
  try {
    execSync(`git clone ${repo.url} ${repoPath}`, { stdio: 'pipe' });
    return repoPath;
  } catch (error: any) {
    throw new Error(`Failed to clone: ${error.message}`);
  }
}

async function discoverCandidates(repoPath: string, repo: RepositoryConfig): Promise<CandidateCommit[]> {
  const candidates: CandidateCommit[] = [];
  
  // Use execSync to get git log with numstat
  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --numstat --format="%H|%P|%an|%ad|%s" -n 500 --no-merges',
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
  } catch (error: any) {
    console.log(chalk.red(`  Failed to get git log: ${error.message}`));
    return candidates;
  }
  
  const lines = logOutput.split('\n');
  const commitCount = lines.filter(l => l.includes('|')).length;
  console.log(chalk.gray(`  Analyzing ${commitCount} commits...`));
  
  let currentCommit: any = null;
  
  for (const line of lines) {
    if (line.includes('|')) {
      // Save previous commit if it has files
      if (currentCommit && currentCommit.files.length > 0) {
        processCommit(currentCommit, candidates);
      }
      
      // Start new commit
      const parts = line.split('|');
      currentCommit = {
        hash: parts[0],
        parentHash: parts[1],
        author: parts[2],
        date: parts[3],
        message: parts.slice(4).join('|'),
        files: []
      };
    } else if (currentCommit && line.trim()) {
      // Parse numstat line: insertions\tdeletions\tfilename
      const parts = line.split('\t');
      if (parts.length >= 3 && parts[2]) {
        currentCommit.files.push({
          file: parts[2].trim(),
          insertions: parseInt(parts[0]) || 0,
          deletions: parseInt(parts[1]) || 0
        });
      }
    }
  }
  
  // Process last commit
  if (currentCommit && currentCommit.files.length > 0) {
    processCommit(currentCommit, candidates);
  }
  
  return candidates.sort((a, b) => b.score - a.score).slice(0, 30);
}

function processCommit(commit: any, candidates: CandidateCommit[]) {
  const { hash, parentHash, message, author, date, files } = commit;
  
  if (!parentHash || parentHash.includes(' ')) return;
  if (files.length === 0) return;
  
  const totalLines = files.reduce((sum: number, f: any) => sum + f.insertions + f.deletions, 0);
  
  if (totalLines < QUALITY_THRESHOLDS.minDiffLines || 
      totalLines > QUALITY_THRESHOLDS.maxDiffLines ||
      files.length > QUALITY_THRESHOLDS.maxFilesChanged) return;
  
  const tsFiles = files.filter((f: any) => f.file.endsWith('.ts') || f.file.endsWith('.tsx'));
  const tsRatio = tsFiles.length / files.length;
  
  if (tsRatio < QUALITY_THRESHOLDS.minTypeScriptRatio) return;
  
  const category = categorizeCommit(message, files);
  if (!category) return;
  
  const score = scoreCommit(message, files, totalLines, tsRatio);
  
  candidates.push({
    hash,
    parentHash,
    message,
    author: author || 'Unknown',
    date: date || new Date().toISOString(),
    files: files.map((f: any) => f.file),
    insertions: files.reduce((s: number, f: any) => s + f.insertions, 0),
    deletions: files.reduce((s: number, f: any) => s + f.deletions, 0),
    score,
    category
  });
}

function categorizeCommit(message: string, files: {file: string}[]): CandidateCommit['category'] | null {
  const msg = message.toLowerCase();
  const hasTest = files.some(f => /test|spec/i.test(f.file));
  
  if (/fix.*type|type.*fix|typo|incorrect type|wrong type|type error/i.test(msg)) return 'typefix';
  if (/fix|bug|error|crash|regression|broken|issue|patch/i.test(msg)) return 'bugfix';
  if (/feat|add|implement|support|feature|new/i.test(msg)) return 'feature';
  if (/test|spec|coverage|test:/i.test(msg) || hasTest) return 'test';
  return null;
}

function scoreCommit(message: string, files: {file: string}[], totalLines: number, tsRatio: number): number {
  let score = 0;
  const msg = message.toLowerCase();
  
  score += tsRatio * 0.3;
  if (files.some(f => /test|spec/i.test(f.file))) score += 0.2;
  
  const idealSize = 50;
  const sizeScore = Math.max(0, 1 - Math.abs(totalLines - idealSize) / idealSize);
  score += sizeScore * 0.2;
  
  if (/fix|resolve|correct|patch/i.test(msg)) score += 0.15;
  if (files.length <= 3) score += 0.15;
  
  return Math.min(score, 1.0);
}

async function validateCandidate(repoPath: string, candidate: CandidateCommit): Promise<boolean> {
  try {
    execSync(`git checkout ${candidate.parentHash}`, { cwd: repoPath, stdio: 'pipe' });
    
    const pkgPath = path.join(repoPath, 'package.json');
    if (!(await fs.pathExists(pkgPath))) return false;
    
    const pkg = await fs.readJson(pkgPath);
    if (!pkg.scripts?.test) return false;
    
    return true;
  } catch {
    return false;
  } finally {
    try {
      execSync('git checkout main', { cwd: repoPath, stdio: 'pipe' });
    } catch {
      try { execSync('git checkout master', { cwd: repoPath, stdio: 'pipe' }); } catch {}
    }
  }
}

async function generateTask(repo: RepositoryConfig, candidate: CandidateCommit, index: number): Promise<any> {
  return {
    id: `${repo.name}-${candidate.category}-${index}`,
    version: '0.2.0',
    repository: { name: repo.name, url: repo.url, category: repo.category },
    baseCommit: candidate.parentHash,
    hiddenFixCommit: candidate.hash,
    prompt: generatePrompt(candidate),
    testCommand: repo.testCommand,
    typecheckCommand: repo.typecheckCommand,
    metadata: {
      category: candidate.category,
      difficulty: calculateDifficulty(candidate),
      filesChanged: candidate.files,
      linesChanged: candidate.insertions + candidate.deletions
    },
    validation: { hiddenTests: [], expectedPatch: '' }
  };
}

function generatePrompt(candidate: CandidateCommit): string {
  return `Fix the following issue in the TypeScript codebase.

Context: ${candidate.message.split('\n')[0]}

Files affected: ${candidate.files.join(', ')}

Run tests with: npm test
Ensure typecheck passes: npm run typecheck

Describe the issue and implement a fix.`;
}

function calculateDifficulty(candidate: CandidateCommit): 'easy' | 'medium' | 'hard' {
  const lines = candidate.insertions + candidate.deletions;
  const files = candidate.files.length;
  
  if (lines < 20 && files <= 2) return 'easy';
  if (lines < 100 && files <= 4) return 'medium';
  return 'hard';
}

function balanceDataset(tasks: any[]): any[] {
  const counts = new Map<string, number>();
  return tasks.filter(task => {
    const key = `${task.repository.name}-${task.metadata.category}`;
    const count = counts.get(key) || 0;
    if (count >= 5) return false;
    counts.set(key, count + 1);
    return true;
  }).slice(0, 150);
}

async function main() {
  console.log(chalk.blue.bold('TypeBench Dataset Expansion'));
  console.log(chalk.gray('Expanding from 9 tasks/3 repos to 50-100+ tasks/8-12 repos\n'));
  
  await ensureDirectories();
  
  const basePath = './data/repos';
  const outputPath = './data/tasks/v0.2.0-candidates';
  const allTasks: any[] = [];
  
  for (const repo of TARGET_REPOS) {
    console.log(chalk.yellow(`\nProcessing ${repo.name}...`));
    
    try {
      const repoPath = await cloneRepo(repo, basePath);
      const candidates = await discoverCandidates(repoPath, repo);
      
      console.log(chalk.gray(`  Found ${candidates.length} candidates`));
      
      if (candidates.length === 0) {
        console.log(chalk.yellow(`  No candidates found for ${repo.name}`));
        continue;
      }
      
      const validated: CandidateCommit[] = [];
      for (const candidate of candidates.slice(0, 15)) {
        if (await validateCandidate(repoPath, candidate)) {
          validated.push(candidate);
        }
      }
      
      console.log(chalk.gray(`  Validated ${validated.length} candidates`));
      
      for (let i = 0; i < validated.length; i++) {
        const task = await generateTask(repo, validated[i], i);
        allTasks.push(task);
      }
    } catch (error: any) {
      console.error(chalk.red(`  Error processing ${repo.name}: ${error.message}`));
    }
  }
  
  if (allTasks.length === 0) {
    console.log(chalk.red.bold('\n✗ No tasks generated!'));
    process.exit(1);
  }
  
  const finalTasks = balanceDataset(allTasks);
  
  try {
    await fs.writeJson(path.join(outputPath, 'tasks.json'), finalTasks, { spaces: 2 });
    
    const fingerprint = createHash('sha256').update(JSON.stringify(finalTasks)).digest('hex');
    
    const manifest = {
      version: '0.2.0',
      generatedAt: new Date().toISOString(),
      taskCount: finalTasks.length,
      repositories: [...new Set(finalTasks.map((t: any) => t.repository.name))],
      fingerprint
    };
    
    await fs.writeJson(path.join(outputPath, 'manifest.json'), manifest, { spaces: 2 });
    
    console.log(chalk.green.bold(`\n✓ Generated ${finalTasks.length} tasks across ${manifest.repositories.length} repositories`));
    console.log(chalk.gray(`Output: ${outputPath}`));
  } catch (error: any) {
    console.error(chalk.red(`\n✗ Failed to write output: ${error.message}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red.bold('Fatal error:'), error);
  process.exit(1);
});