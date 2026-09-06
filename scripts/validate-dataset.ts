/**
 * Dataset Expansion Script - COMPLETELY FIXED
 */
import fs from 'fs-extra';
import path from 'path';
import { simpleGit } from 'simple-git';
import chalk from 'chalk';
import ora from 'ora';
import { createHash } from 'crypto'; // FIXED: ES module import

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

// RELAXED THRESHOLDS to find more candidates
const QUALITY_THRESHOLDS = {
  minDiffLines: 5,        // Reduced from 10
  maxDiffLines: 500,      // Increased from 300
  maxFilesChanged: 15,    // Increased from 8
  minTypeScriptRatio: 0.4 // Reduced from 0.6
};

async function ensureDirectories() {
  const dirs = [
    './data',
    './data/repos',
    './data/tasks',
    './data/tasks/v0.2.0-candidates',
    './releases'
  ];
  
  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }
  console.log(chalk.gray('✓ Directories ready'));
}

async function cloneRepo(repo: RepositoryConfig, basePath: string): Promise<string> {
  const repoPath = path.join(basePath, repo.name);
  
  if (await fs.pathExists(repoPath)) {
    const git = simpleGit(repoPath);
    try {
      await git.log(['-n', '1']);
      console.log(chalk.gray(`  ${repo.name} already cloned`));
      return repoPath;
    } catch {
      await fs.remove(repoPath);
    }
  }
  
  const spinner = ora(`Cloning ${repo.name}...`).start();
  try {
    const git = simpleGit();
    await git.clone(repo.url, repoPath, ['--depth', '1000']);
    spinner.succeed(`Cloned ${repo.name}`);
    return repoPath;
  } catch (error: any) {
    spinner.fail(`Failed to clone ${repo.name}: ${error.message}`);
    throw error;
  }
}

async function discoverCandidates(repoPath: string, repo: RepositoryConfig): Promise<CandidateCommit[]> {
  const git = simpleGit(repoPath);
  
  const log = await git.log([
    '--numstat', 
    '--format=%H|%P|%an|%ad|%s', 
    '-n', '1000',  // Increased from 500
    '--no-merges'
  ]);
  
  const candidates: CandidateCommit[] = [];
  
  console.log(chalk.gray(`  Analyzing ${log.all.length} commits...`));
  
  for (const commit of log.all) {
    try {
      const [hash, parentHash, author, date, ...messageParts] = commit.hash.split('|');
      const message = messageParts.join('|') || commit.message;
      
      if (!parentHash || parentHash.includes(' ')) continue;
      
      const diff = await git.diff(['--numstat', parentHash, hash]);
      const files = diff.split('\n')
        .filter(l => l.trim())
        .map(l => {
          const parts = l.split('\t');
          return { 
            file: parts[2], 
            insertions: parseInt(parts[0]) || 0, 
            deletions: parseInt(parts[1]) || 0 
          };
        })
        .filter(f => f.file);
      
      if (files.length === 0) continue;
      
      const totalLines = files.reduce((sum, f) => sum + f.insertions + f.deletions, 0);
      
      // Apply thresholds
      if (totalLines < QUALITY_THRESHOLDS.minDiffLines || 
          totalLines > QUALITY_THRESHOLDS.maxDiffLines ||
          files.length > QUALITY_THRESHOLDS.maxFilesChanged) continue;
      
      const tsFiles = files.filter(f => f.file.endsWith('.ts') || f.file.endsWith('.tsx'));
      const tsRatio = tsFiles.length / files.length;
      
      if (tsRatio < QUALITY_THRESHOLDS.minTypeScriptRatio) continue;
      
      const category = categorizeCommit(message, files);
      if (!category) continue;
      
      const score = scoreCommit(message, files, totalLines, tsRatio);
      
      candidates.push({
        hash,
        parentHash,
        message,
        author: author || 'Unknown',
        date: date || new Date().toISOString(),
        files: files.map(f => f.file),
        insertions: files.reduce((s, f) => s + f.insertions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
        score,
        category
      });
    } catch (err) {
      continue;
    }
  }
  
  return candidates.sort((a, b) => b.score - a.score).slice(0, 30); // Increased from 20
}

function categorizeCommit(message: string, files: {file: string}[]): CandidateCommit['category'] | null {
  const msg = message.toLowerCase();
  const hasTest = files.some(f => /test|spec/i.test(f.file));
  
  // More inclusive patterns
  if (/fix.*type|type.*fix|typo|incorrect type|wrong type|type error/i.test(msg)) return 'typefix';
  if (/fix|bug|error|crash|regression|broken|issue/i.test(msg)) return 'bugfix';
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
  const git = simpleGit(repoPath);
  
  try {
    await git.checkout(candidate.parentHash);
    
    const pkgPath = path.join(repoPath, 'package.json');
    if (!(await fs.pathExists(pkgPath))) return false;
    
    const pkg = await fs.readJson(pkgPath);
    if (!pkg.scripts?.test) return false;
    
    return true;
  } catch {
    return false;
  } finally {
    try {
      await git.checkout('main');
    } catch {
      try {
        await git.checkout('master');
      } catch {}
    }
  }
}

async function generateTask(repo: RepositoryConfig, candidate: CandidateCommit, index: number): Promise<any> {
  return {
    id: `${repo.name}-${candidate.category}-${index}`,
    version: '0.2.0',
    repository: {
      name: repo.name,
      url: repo.url,
      category: repo.category
    },
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
    validation: {
      hiddenTests: [],
      expectedPatch: ''
    }
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
  // Allow more tasks per repo-category
  const counts = new Map<string, number>();
  return tasks.filter(task => {
    const key = `${task.repository.name}-${task.metadata.category}`;
    const count = counts.get(key) || 0;
    if (count >= 5) return false; // Increased from 3
    counts.set(key, count + 1);
    return true;
  }).slice(0, 150); // Increased from 100
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
      for (const candidate of candidates.slice(0, 15)) { // Increased from 10
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
    console.log(chalk.red.bold('\n✗ No tasks generated! Check errors above.'));
    process.exit(1);
  }
  
  const finalTasks = balanceDataset(allTasks);
  
  try {
    // Write tasks.json
    await fs.writeJson(path.join(outputPath, 'tasks.json'), finalTasks, { spaces: 2 });
    console.log(chalk.gray(`  Wrote tasks.json (${finalTasks.length} tasks)`));
    
    // FIXED: Use imported createHash, not require
    const fingerprint = createHash('sha256').update(JSON.stringify(finalTasks)).digest('hex');
    
    const manifest = {
      version: '0.2.0',
      generatedAt: new Date().toISOString(),
      taskCount: finalTasks.length,
      repositories: [...new Set(finalTasks.map((t: any) => t.repository.name))],
      fingerprint
    };
    
    await fs.writeJson(path.join(outputPath, 'manifest.json'), manifest, { spaces: 2 });
    console.log(chalk.gray(`  Wrote manifest.json`));
    
    console.log(chalk.green.bold(`\n✓ Generated ${finalTasks.length} tasks across ${manifest.repositories.length} repositories`));
    console.log(chalk.gray(`Output: ${outputPath}`));
    console.log(chalk.gray(`Fingerprint: ${fingerprint}`));
    
  } catch (error: any) {
    console.error(chalk.red(`\n✗ Failed to write output: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red.bold('Fatal error:'), error);
  process.exit(1);
});