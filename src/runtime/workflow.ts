import type { WorkflowDAG, WorkflowStep } from './domain.ts';

export class WorkflowExecutor {
  async execute(dag: WorkflowDAG, handler: (step: WorkflowStep) => Promise<void>): Promise<void> {
    const pending = new Map(dag.steps.map((step) => [step.id, step]));
    if (pending.size !== dag.steps.length) throw new Error('Duplicate workflow step');
    const completed = new Set<string>();
    while (pending.size) {
      const ready = [...pending.values()].find((step) => step.dependsOn.every((id) => completed.has(id)));
      if (!ready) throw new Error('Workflow has a cycle or missing dependency');
      await handler(ready);
      completed.add(ready.id);
      pending.delete(ready.id);
    }
  }
}
