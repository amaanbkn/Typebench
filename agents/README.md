# Adding Pluggable Agent Adapters

Typebench supports pluggable agents by implementing the `BaseAgent` interface.

---

## Agent Interface

All agents must implement `BaseAgent` from [`base-agent.ts`](base-agent.ts):

```typescript
export interface BaseAgent {
  readonly name: string;
  initialize?(): Promise<void>;
  solveTask(context: AgentContext): Promise<AgentResponse>;
  cleanup?(): Promise<void>;
}
```

---

## Steps to Add a New Agent

1. Create a directory under `agents/<agent-name>/` (e.g. `agents/claude/index.ts`).
2. Implement the `BaseAgent` interface or extend `AbstractBaseAgent`.
3. Read task instructions and workspace context from `AgentContext`.
4. Implement your agent loop (model inference, tool execution, file editing).
5. Export your agent instance as the default export.
6. Register the agent name in the harness CLI or adapter registry.

---

## Running with Your Agent

```bash
npm run typebench -- run task_001 --agent <agent-name>
```
