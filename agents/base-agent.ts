/**
 * Standardized Coding-Agent Interface
 * Defines generic agent interfaces, contexts, and results for Typebench evaluations.
 */

export type AgentStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'infrastructure_failure';

export interface AgentEnvironmentInfo {
  nodeVersion?: string;
  packageManager?: string;
  packageManagerVersion?: string;
}

export interface AgentContext {
  taskId: string;
  taskPrompt: string;
  repository: string;
  repositoryUrl: string;
  baseCommit: string;
  workspacePath: string;
  timeoutMs: number;
  environment: AgentEnvironmentInfo;
}

export interface AgentResult {
  runId: string;
  taskId: string;
  agentName: string;
  status: AgentStatus;
  exitCode: number;
  durationMs: number;
  changedFiles: string[];
  patch: string;
  stdout: string;
  stderr: string;
  tokensUsed?: number;
  error?: string;
  timestamp: string;
}

export interface CodingAgent {
  /**
   * Unique name of the agent (e.g. 'mock', 'nemotron', 'claude-3-5-sonnet')
   */
  readonly name: string;

  /**
   * Optional initialization step before starting task executions (e.g. validating API keys)
   */
  initialize?(): Promise<void>;

  /**
   * Executes the coding agent on the task context inside the isolated workspace
   */
  run(context: AgentContext): Promise<Omit<AgentResult, 'runId' | 'taskId' | 'changedFiles' | 'patch' | 'timestamp'>>;

  /**
   * Backward-compatible solveTask alias
   */
  solveTask?(context: any): Promise<any>;

  /**
   * Optional teardown/cleanup logic after task completes
   */
  cleanup?(): Promise<void>;
}

export abstract class AbstractCodingAgent implements CodingAgent {
  abstract readonly name: string;

  async initialize(): Promise<void> {
    // Default no-op
  }

  abstract run(
    context: AgentContext
  ): Promise<Omit<AgentResult, 'runId' | 'taskId' | 'changedFiles' | 'patch' | 'timestamp'>>;

  async solveTask(context: AgentContext): Promise<any> {
    return this.run(context);
  }

  async cleanup(): Promise<void> {
    // Default no-op
  }
}
