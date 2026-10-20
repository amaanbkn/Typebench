/**
 * Core type definitions for Typebench Evaluation Engine
 */

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export type TaskDifficulty = 'easy' | 'medium' | 'hard';

export interface RepoRef {
  task_id: string;
  repo_url: string;
  base_commit: string;
  branch?: string;
  package_manager: PackageManager;
  node_version?: string;
  difficulty?: TaskDifficulty;
  tags?: string[];
}

export interface TaskDefinition {
  id: string;
  path: string;
  repoRef: RepoRef;
  instructions: string;
  verifyScript: string;
}

export interface AgentContext {
  taskId: string;
  workspacePath: string;
  instructions: string;
  repoRef: RepoRef;
  timeoutMs: number;
}

export interface AgentResponse {
  success: boolean;
  message?: string;
  tokensUsed?: number;
  durationMs: number;
  error?: string;
}

export interface ScoreReport {
  taskId: string;
  agentName: string;
  passed: boolean;
  durationMs: number;
  exitCode: number;
  output: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface RunOptions {
  taskId: string;
  agentName: string;
  timeout?: number;
  sandbox?: boolean;
  verbose?: boolean;
}
