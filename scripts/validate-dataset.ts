/**
 * Dataset Validation Script
 */
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createHash } from 'crypto';

interface ValidationResult {
  check: string;
  passed: boolean;
  details?: string;
}

async function validateDataset(datasetPath: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  const tasks = await fs.readJson(path.join(datasetPath, 'tasks.json'));
  results.push({
    check: 'Schema Validation',
    passed: Array.isArray(tasks) && tasks.every((t: any) => t.id && t.baseCommit && t.prompt),
    details: `${tasks.length} tasks validated`
  });
  
  const repos = new Set(tasks.map((t: any) => t.repository.name));
  results.push({
    check: 'Repository Distribution',
    passed: repos.size >= 8,
    details: `${repos.size} repositories (target: 8-12)`
  });
  
  results.push({
    check: 'Task Count',
    passed: tasks.length >= 50,
    details: `${tasks.length} tasks (target: 50-100+)`
  });
  
  const categories = new Set(tasks.map((t: any) => t.metadata.category));
  results.push({
    check: 'Category Diversity',
    passed: categories.size >= 3,
    details: `Categories: ${[...categories].join(', ')}`
  });
  
  const difficulties = tasks.reduce((acc: any, t: any) => {
    acc[t.metadata.difficulty] = (acc[t.metadata.difficulty] || 0) + 1;
    return acc;
  }, {});
  results.push({
    check: 'Difficulty Distribution',
    passed: (difficulties.easy > 0) && (difficulties.hard > 0),
    details: JSON.stringify(difficulties)
  });
  
  const baseCommits = tasks.map((t: any) => t.baseCommit);
  const uniqueCommits = new Set(baseCommits);
  results.push({
    check: 'No Duplicate Tasks',
    passed: baseCommits.length === uniqueCommits.size,
    details: `${uniqueCommits.size} unique commits`
  });
  
  results.push({
    check: 'Anti-Contamination',
    passed: tasks.every((t: any) => t.hiddenFixCommit && t.hiddenFixCommit !== t.baseCommit),
    details: 'All hidden fix commits properly separated'
  });
  
  const manifest = await fs.readJson(path.join(datasetPath, 'manifest.json'));
  const fingerprint = createHash('sha256').update(JSON.stringify(tasks)).digest('hex');
  results.push({
    check: 'Fingerprint Integrity',
    passed: fingerprint === manifest.fingerprint,
    details: `Expected: ${manifest.fingerprint}, Actual: ${fingerprint}`
  });
  
  return results;
}

async function main() {
  const datasetPath = process.argv[2] || './data/tasks/v0.2.0-candidates';
  
  console.log(chalk.blue.bold('TypeBench Dataset Validation\n'));
  
  const results = await validateDataset(datasetPath);
  
  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const color = result.passed ? chalk.green : chalk.red;
    console.log(`${icon} ${color(result.check)}: ${result.details}`);
    if (!result.passed) allPassed = false;
  }
  
  console.log();
  if (allPassed) {
    console.log(chalk.green.bold('✓ All checks passed! Dataset ready for release.'));
    process.exit(0);
  } else {
    console.log(chalk.red.bold('✗ Validation failed. Fix issues before release.'));
    process.exit(1);
  }
}

main().catch(console.error);