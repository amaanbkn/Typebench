/**
 * Release Preparation Script
 */
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { createHash } from 'crypto';

async function generateFingerprint(content: string): Promise<string> {
  return createHash('sha256').update(content).digest('hex');
}

async function prepareRelease(version: string) {
  const sourceDir = './data/tasks/v0.2.0-candidates';
  const releaseDir = `./releases/typebench-${version}`;
  
  console.log(chalk.blue(`Preparing release ${version}...`));
  
  await fs.ensureDir(releaseDir);
  await fs.ensureDir(path.join(releaseDir, 'dataset'));
  await fs.ensureDir(path.join(releaseDir, 'docs'));
  
  const tasks = await fs.readJson(path.join(sourceDir, 'tasks.json'));
  const fingerprint = await generateFingerprint(JSON.stringify(tasks));
  
  await fs.writeJson(path.join(releaseDir, 'dataset', 'tasks.json'), tasks, { spaces: 2 });
  await fs.writeJson(path.join(releaseDir, 'dataset', 'fingerprint.json'), {
    version,
    fingerprint,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256'
  }, { spaces: 2 });
  
  const readme = `# TypeBench ${version}

TypeScript-specific benchmark for AI coding agents.

## Dataset

- **Version**: ${version}
- **Tasks**: ${tasks.length}
- **Repositories**: ${new Set(tasks.map((t: any) => t.repository.name)).size}
- **Fingerprint**: \`${fingerprint}\`

## Usage

\`\`\`bash
npx typebench verify --dataset ${version}
npx typebench run --agent <name> --trials 5
npx typebench eval --results results/raw/*.json
npx typebench leaderboard
\`\`\`

## Protocol

- 70% benchmark correctness (hidden tests)
- 15% typecheck correctness
- 15% regression correctness
- 3 repeated trials minimum
- Anti-contamination enforced

## License

MIT
`;
  
  await fs.writeFile(path.join(releaseDir, 'README.md'), readme);
  
  console.log(chalk.green(`✓ Release prepared: ${releaseDir}`));
  console.log(chalk.gray(`Fingerprint: ${fingerprint}`));
}

const version = process.argv[2] || 'v1.0.0';
prepareRelease(version).catch(console.error);