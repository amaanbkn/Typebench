/**
 * Base Agent Interface
 * All agent adapters in Typebench implement this interface.
 */

import { AgentContext, AgentResponse } from '../harness/src/types.js';

export interface BaseAgent {
  /**
   * Unique name of the agent wrapper (e.g. 'nemotron', 'claude-3-5-sonnet', 'gpt-4o')
   */
  readonly name: string;

  /**
   * Optional initialization step before starting task executions (e.g. validating API keys)
   */
  initialize?(): Promise<void>;

  /**
   * Executes the coding task in the specified workspace context
   * @param context Target workspace path, instructions, and timeout details
   */
  solveTask(context: AgentContext): Promise<AgentResponse>;

  /**
   * Optional teardown/cleanup logic after task completes
   */
  cleanup?(): Promise<void>;
}

export abstract class AbstractBaseAgent implements BaseAgent {
  abstract readonly name: string;

  async initialize(): Promise<void> {
    // Default no-op
  }

  abstract solveTask(context: AgentContext): Promise<AgentResponse>;

  async cleanup(): Promise<void> {
    // Default no-op
  }
}
