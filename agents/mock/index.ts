/**
 * Deterministic Mock Agent
 * Verifies agent runner lifecycles, context injection, file modifications, and diff capture.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AbstractCodingAgent, AgentContext, AgentResult } from '../base-agent.js';

export class MockAgent extends AbstractCodingAgent {
  readonly name = 'mock';

  async run(
    context: AgentContext
  ): Promise<Omit<AgentResult, 'runId' | 'taskId' | 'changedFiles' | 'patch' | 'timestamp'>> {
    const startTime = Date.now();

    // Verify workspace path exists
    if (!fs.existsSync(context.workspacePath)) {
      return {
        agentName: this.name,
        status: 'infrastructure_failure',
        exitCode: 1,
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: `Workspace directory not found: ${context.workspacePath}`,
        error: 'Target workspace does not exist.',
      };
    }

    // Perform a harmless deterministic modification in the workspace to test Git diff capture
    const markerFile = path.join(context.workspacePath, 'TYPEBENCH_AGENT_SOLUTION.md');
    const content = `# TypeBench Solution Marker\n\nTask ID: ${context.taskId}\nAgent: ${this.name}\nBase Commit: ${context.baseCommit}\nApplied: ${new Date().toISOString()}\n\n## Agent Assessment\n${context.taskPrompt.slice(0, 300)}...\n`;

    fs.writeFileSync(markerFile, content, 'utf-8');

    return {
      agentName: this.name,
      status: 'completed',
      exitCode: 0,
      durationMs: Date.now() - startTime,
      stdout: `[MockAgent] Inspected prompt for task ${context.taskId} and applied solution marker to workspace.`,
      stderr: '',
      tokensUsed: 42,
    };
  }
}

export default new MockAgent();
