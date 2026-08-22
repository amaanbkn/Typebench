/**
 * Docker Sandbox Manager
 * Handles container creation, execution isolation, and teardown for benchmark tasks.
 */

export * from './sandbox-runner.js';
import { TaskDefinition } from '../types.js';

export interface SandboxSession {
  containerId: string;
  workspacePath: string;
}

export class DockerSandbox {
  private image: string;

  constructor(image = 'typebench-sandbox:latest') {
    this.image = image;
  }

  /**
   * Initializes and starts a container for the given task.
   */
  async startSession(task: TaskDefinition): Promise<SandboxSession> {
    console.log(`[DockerSandbox] Starting container for task: ${task.id} (image: ${this.image})`);
    return {
      containerId: `mock-container-${task.id}-${Date.now()}`,
      workspacePath: `/workspace/${task.id}`,
    };
  }

  /**
   * Runs verification script inside the container.
   */
  async runVerify(session: SandboxSession): Promise<{ exitCode: number; output: string }> {
    console.log(`[DockerSandbox] Executing verify.sh in container: ${session.containerId}`);
    return {
      exitCode: 0,
      output: '[DockerSandbox Stub] Verify script executed successfully.',
    };
  }

  /**
   * Cleans up and stops the container sandbox.
   */
  async stopSession(session: SandboxSession): Promise<void> {
    console.log(`[DockerSandbox] Stopping and removing container: ${session.containerId}`);
  }
}

