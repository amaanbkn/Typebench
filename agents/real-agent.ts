/**
 * Real Agent Interface
 * Standardized interface for running real coding agents
 */
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

export interface AgentConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface TaskContext {
  taskId: string;
  repoPath: string;
  prompt: string;
  testCommand: string;
  typecheckCommand: string;
}

export interface AgentResult {
  success: boolean;
  patch: string;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}

export abstract class BaseAgent extends EventEmitter {
  abstract readonly name: string;
  
  async runTask(context: TaskContext): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      const workspace = await this.prepareWorkspace(context);
      await this.executeAgent(workspace, context);
      const patch = await this.extractPatch(workspace);
      
      return {
        success: true,
        patch,
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        patch: '',
        error: error.message,
        durationMs: Date.now() - startTime
      };
    }
  }
  
  protected async prepareWorkspace(context: TaskContext): Promise<string> {
    const workspace = path.join('/tmp/typebench-workspaces', context.taskId);
    await fs.ensureDir(workspace);
    await fs.copy(context.repoPath, workspace);
    await fs.writeFile(path.join(workspace, 'TASK.md'), context.prompt);
    return workspace;
  }
  
  protected abstract executeAgent(workspace: string, context: TaskContext): Promise<void>;
  
  protected async extractPatch(workspace: string): Promise<string> {
    const { stdout } = await execa('git', ['diff'], { cwd: workspace });
    return stdout;
  }
}

export class ClaudeAgent extends BaseAgent {
  readonly name = 'claude';
  
  constructor(private config: AgentConfig) {
    super();
  }
  
  protected async executeAgent(workspace: string, context: TaskContext): Promise<void> {
    await execa(this.config.command, [
      ...this.config.args,
      '-p', context.prompt,
      '--allowedTools', 'Read,Edit,Bash'
    ], {
      cwd: workspace,
      env: { ...process.env, ...this.config.env },
      timeout: this.config.timeoutMs
    });
  }
}

export class AiderAgent extends BaseAgent {
  readonly name = 'aider';
  
  constructor(private config: AgentConfig) {
    super();
  }
  
  protected async executeAgent(workspace: string, context: TaskContext): Promise<void> {
    await execa(this.config.command, [
      '--message', context.prompt,
      '--no-auto-commits'
    ], {
      cwd: workspace,
      env: { ...process.env, ...this.config.env },
      timeout: this.config.timeoutMs
    });
  }
}

export class OpenRouterAgent extends BaseAgent {
  readonly name = 'openrouter';
  
  constructor(private config: AgentConfig) {
    super();
  }
  
  protected async executeAgent(workspace: string, context: TaskContext): Promise<void> {
    // For API-based agents, write prompt and call API
    await fs.writeFile(path.join(workspace, 'PROMPT.txt'), context.prompt);
    
    // Example: call OpenRouter API via curl or SDK
    await execa('curl', [
      '-X', 'POST',
      'https://openrouter.ai/api/v1/chat/completions',
      '-H', `Authorization: Bearer ${process.env.OPENROUTER_API_KEY}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: context.prompt }]
      })
    ], {
      cwd: workspace,
      timeout: this.config.timeoutMs
    });
  }
}

export class MockAgent extends BaseAgent {
  readonly name = 'mock';
  
  constructor(private mockPatch: string = '') {
    super();
  }
  
  protected async executeAgent(workspace: string, context: TaskContext): Promise<void> {
    if (this.mockPatch) {
      await execa('git', ['apply'], { 
        cwd: workspace, 
        input: this.mockPatch 
      });
    }
  }
}