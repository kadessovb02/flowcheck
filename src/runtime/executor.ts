import { createHash, randomUUID } from 'node:crypto';
import type { CodingModel, CodeContextProvider, ControlDecision, ControlPlane, EventStore, ModelResult, RuntimeEvent, RuntimeState, TaskDefinition, VerificationResult, WorkflowDAG } from './domain.ts';
import { ContextCompiler } from './context.ts';
import { DeterministicControlPlane, ModelRouter, SafetyPolicy, TaskCompiler, WorkflowCompiler } from './policy.ts';
import { SkillRegistry, SkillRetriever } from './skills.ts';
import { VerificationEngine, command } from './adapters.ts';
import { skillUtility } from './metrics.ts';
import { WorkflowExecutor } from './workflow.ts';
import path from 'node:path';

class SafetyViolation extends Error {}

export interface RuntimeOptions {
  root: string;
  contextBudget?: number;
  enableSkillGraph?: boolean;
  enableExperienceStore?: boolean;
  enableAdaptiveRouting?: boolean;
  includeE2e?: boolean;
  maxAttempts?: number;
  requireCleanWorktree?: boolean;
}

export interface RunSummary {
  runId: string;
  status: 'accepted' | 'failed' | 'escalated' | 'blocked';
  task: TaskDefinition;
  workflow: WorkflowDAG;
  contextTokens: number;
  selectedSkills: string[];
  selectedFiles: string[];
  verification: VerificationResult[];
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  reason?: string;
}

export class SoftwareEngineeringRuntime {
  private readonly compiler = new TaskCompiler();
  private readonly workflowCompiler = new WorkflowCompiler();
  private readonly promptCompiler = new ContextCompiler();
  private readonly safety = new SafetyPolicy();
  private async skills(): Promise<SkillRetriever> {
    const events = this.options.enableExperienceStore === false ? [] : await this.ports.store.read();
    const registry = await SkillRegistry.load(path.join(this.options.root, 'runtime-skills'));
    return new SkillRetriever(registry, skillUtility(events));
  }
  private readonly ports: {
    context: CodeContextProvider; control?: ControlPlane; model: CodingModel; store: EventStore;
    verifier?: { run(includeE2e?: boolean): Promise<VerificationResult[]> };
    router?: ModelRouter;
  };
  private readonly options: RuntimeOptions;
  constructor(ports: SoftwareEngineeringRuntime['ports'], options: RuntimeOptions) { this.ports = ports; this.options = options; }

  async plan(text: string, changedFiles: string[] = []): Promise<{ task: TaskDefinition; contextTokens: number; selectedSkills: string[]; selectedFiles: string[]; workflow: WorkflowDAG; control: ControlDecision }> {
    const task = this.compiler.compile(text, changedFiles);
    const context = await this.ports.context.getContext(text, changedFiles, Math.floor((this.options.contextBudget ?? 32_000) * 0.35));
    const control = await (this.ports.control ?? new DeterministicControlPlane()).decide({ task, context, attempt: 0 });
    const skills = this.options.enableSkillGraph === false ? [] : await (await this.skills()).retrieve(text, context, Math.floor((this.options.contextBudget ?? 32_000) * 0.1));
    const compiled = this.promptCompiler.compile(text, context, skills, this.options.contextBudget ?? 32_000);
    return { task, contextTokens: compiled.tokens, selectedSkills: skills.map((x) => x.id), selectedFiles: compiled.selectedFiles,
      workflow: this.workflowCompiler.compile(task, context, control), control };
  }

  async run(text: string, changedFiles: string[] = []): Promise<RunSummary> {
    const started = Date.now();
    const runId = randomUUID();
    const traceId = randomUUID().replaceAll('-', '');
    const emit = async (type: string, data: Record<string, unknown>) => {
      if (this.options.enableExperienceStore !== false) await this.ports.store.append({ runId, traceId, spanId: randomUUID().replaceAll('-', '').slice(0, 16),
        at: new Date().toISOString(), type, data } satisfies RuntimeEvent);
    };
    const task = this.compiler.compile(text, changedFiles);
    const empty: RunSummary = { runId, status: 'failed', task, workflow: { steps: [] }, contextTokens: 0, selectedSkills: [], selectedFiles: [], verification: [], modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
    const finish = async (status: RunSummary['status'], reason?: string): Promise<RunSummary> => {
      empty.status = status; empty.reason = reason; empty.durationMs = Date.now() - started;
      await emit('outcome', { status, reason, durationMs: empty.durationMs });
      return empty;
    };
    await emit('task', { taskType: task.type, complexity: task.complexity, risk: task.risk, taskHash: createHash('sha256').update(text).digest('hex') });
    const violations = this.safety.assess(text);
    if (violations.length) return finish('blocked', `Safety policy requires additional verification: ${violations.join(', ')}`);
    try {
      const initialStatus = await command('git', ['status', '--porcelain'], this.options.root, 10_000);
      if (initialStatus.code !== 0) return finish('failed', 'Runtime requires a Git repository');
      if (this.options.requireCleanWorktree !== false && initialStatus.output.trim()) return finish('blocked', 'Runtime requires a clean worktree');
      const initialHead = await command('git', ['rev-parse', 'HEAD'], this.options.root, 10_000);
      const diffBase = initialHead.code === 0 ? ['HEAD'] : [];
      const context = await this.ports.context.getContext(text, changedFiles, Math.floor((this.options.contextBudget ?? 32_000) * 0.35));
      const state: RuntimeState = { task, context, attempt: 0 };
      const controlPlane = this.ports.control ?? new DeterministicControlPlane();
      let control = await controlPlane.decide(state);
      await emit('control', { ...control });
      const skills = this.options.enableSkillGraph === false ? [] : await (await this.skills()).retrieve(text, context, Math.floor((this.options.contextBudget ?? 32_000) * 0.1));
      const compiled = this.promptCompiler.compile(text, context, skills, this.options.contextBudget ?? 32_000);
      empty.contextTokens = compiled.tokens;
      empty.selectedFiles = compiled.selectedFiles;
      empty.selectedSkills = skills.map((skill) => skill.id);
      await emit('context', { source: context.source, files: context.relevantFiles, estimatedTokens: context.estimatedTokens,
        promptTokens: compiled.tokens, baselineTokens: context.baselineTokens ?? null, savedTokens: context.savedTokens ?? null });
      await emit('skills', { ids: empty.selectedSkills });
      empty.workflow = this.workflowCompiler.compile(task, context, control);
      await emit('workflow', { steps: empty.workflow.steps });
      const router = this.ports.router ?? new ModelRouter();
      const model = router.select(task, this.options.enableAdaptiveRouting === false ? { ...control, modelTier: 'standard' } : control);
      await emit('routing', { tier: model.tier, model: model.model ?? 'default' });
      const call = async (role: 'planner' | 'implementer' | 'reviewer', prompt: string): Promise<ModelResult> => {
        const result = await this.ports.model.run(prompt, model, role);
        empty.modelCalls += 1; empty.inputTokens += result.inputTokens; empty.outputTokens += result.outputTokens;
        empty.costUsd = empty.costUsd === null || result.costUsd === null ? null : empty.costUsd + result.costUsd;
        await emit('model_call', { role, tier: model.tier, model: model.model ?? 'default', inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens ?? 0, outputTokens: result.outputTokens, latencyMs: result.latencyMs, costUsd: result.costUsd });
        return result;
      };
      let plan = '';
      const verifier = this.ports.verifier ?? new VerificationEngine(this.options.root);
      for (let attempt = 1; attempt <= (this.options.maxAttempts ?? 2); attempt++) {
        state.attempt = attempt;
        let reviewFindings: unknown;
        await new WorkflowExecutor().execute(empty.workflow, async (step) => {
          await emit('step', { id: step.id, attempt, status: 'started' });
          if (step.kind === 'plan' && attempt === 1) plan = (await call('planner', `${compiled.prompt}\n\nProvide a concise implementation plan only.`)).output;
          if (step.kind === 'implement') await call('implementer', `${compiled.prompt}\n\n${plan ? `Plan: ${plan}\n` : ''}Implement the task. Do not perform force pushes, production deployments, destructive migrations, secret changes, or irreversible filesystem operations. Keep changes scoped to the task.`);
          if (step.kind === 'verify') {
            const currentHead = await command('git', ['rev-parse', 'HEAD'], this.options.root, 10_000);
            if (initialHead.code === 0 && currentHead.output.trim() !== initialHead.output.trim()) throw new SafetyViolation('Codex changed the repository HEAD');
            const names = await command('git', ['diff', ...diffBase, '--name-status'], this.options.root, 10_000);
            const patch = await command('git', ['diff', ...diffBase, '--unified=0'], this.options.root, 10_000);
            const untracked = await command('git', ['ls-files', '--others', '--exclude-standard'], this.options.root, 10_000);
            const violations = this.safety.assessPatch(`${names.output}\n${untracked.output.split('\n').filter(Boolean).map((file) => `A\t${file}`).join('\n')}`, patch.output);
            if (violations.length) throw new SafetyViolation(`Patch requires additional verification: ${violations.join(', ')}`);
            empty.verification = await verifier.run(this.options.includeE2e || task.requiredVerification.includes('test:e2e'));
            for (const result of empty.verification) await emit('verification', { ...result });
          }
          if (step.kind === 'impact') {
            const changed = await command('git', ['diff', ...diffBase, '--name-only'], this.options.root, 10_000);
            const untracked = await command('git', ['ls-files', '--others', '--exclude-standard'], this.options.root, 10_000);
            const changedPaths = [...new Set(`${changed.output}\n${untracked.output}`.trim().split('\n').filter(Boolean))];
            await emit('patch', { files: changedPaths });
            const impact = await this.ports.context.getContext(text, changedPaths, 1000);
            await emit('impact', { source: impact.source, files: impact.relevantFiles, affectedFlows: impact.affectedFlows, riskFeatures: impact.riskFeatures });
          }
          if (step.kind === 'review' && empty.verification.every((result) => result.passed)) {
            const focus = control.needSecurityReview ? 'Focus on authorization, input validation, secrets, and security regressions.' : 'Focus on behavior and regressions.';
            const review = await call('reviewer', `Review the current git diff in ${this.options.root}. Do not edit files. Task: ${text}\n${focus}\nReturn only JSON: {"findings":[{"file":"...","reason":"..."}]}. Include only actionable defects; return an empty findings array when none exist.`);
            let findings: unknown;
            try { findings = (JSON.parse(review.output) as Record<string, unknown>).findings; } catch { /* malformed review cannot approve */ }
            reviewFindings = findings;
            await emit('review', { findings: Array.isArray(findings) ? findings : null, raw: review.output.slice(0, 4000) });
          }
          if (step.kind === 'decision') {
            state.verification = empty.verification;
            control = await controlPlane.decide(state);
            await emit('control', { ...control });
          }
          await emit('step', { id: step.id, attempt, status: 'completed' });
        });
        if (control.action === 'retry') continue;
        if (control.action === 'escalate') return finish('escalated', 'Verification failed after retry');
        if (empty.workflow.steps.some((step) => step.kind === 'review')) {
          if (!Array.isArray(reviewFindings)) return finish('escalated', 'Reviewer response could not be parsed');
          if (reviewFindings.length) return finish('escalated', `${reviewFindings.length} review finding(s) require assessment`);
        }
        return finish('accepted');
      }
      return finish('escalated', 'Attempt limit reached');
    } catch (error) {
      if (error instanceof SafetyViolation) return finish('blocked', error.message);
      return finish('failed', error instanceof Error ? error.message : String(error));
    }
  }
}
