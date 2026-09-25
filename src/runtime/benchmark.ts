import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { EventStore, RuntimeEvent, VerificationResult } from './domain.ts';
import { CodexCliModel, VerificationEngine, command } from './adapters.ts';
import { ContextCompiler, GraphCodeContextProvider, LexicalCodeContextProvider } from './context.ts';
import { SoftwareEngineeringRuntime } from './executor.ts';
import { compareBenchmarks } from './metrics.ts';
import { DeterministicControlPlane, SafetyPolicy } from './policy.ts';

export const BENCHMARK_MODES = ['vanilla_codex', 'codex_superpowers', 'codex_code_graph', 'full_runtime'] as const;
export type BenchmarkMode = typeof BENCHMARK_MODES[number];

export class BenchmarkRunner {
  private readonly root: string;
  private readonly store: EventStore;
  constructor(root: string, store: EventStore) { this.root = root; this.store = store; }

  async run(task: string, modes: readonly BenchmarkMode[] = BENCHMARK_MODES): Promise<Record<string, unknown>> {
    const violations = new SafetyPolicy().assess(task);
    if (violations.length) throw new Error(`Benchmark blocked by safety policy: ${violations.join(', ')}`);
    const session = randomUUID();
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-benchmark-'));
    const results: Record<string, unknown> = {};
    try {
      for (const mode of modes) {
        const checkout = path.join(workingDirectory, mode);
        const created = await command('git', ['worktree', 'add', '--detach', checkout, 'HEAD'], this.root, 30_000);
        if (created.code !== 0) throw new Error(`Could not create benchmark worktree: ${created.output}`);
        const previousGraphDir = process.env.CRG_DATA_DIR;
        process.env.CRG_DATA_DIR = path.join(checkout, '.flowcheck', 'codegraph');
        const runId = randomUUID();
        const emit = async (type: string, data: Record<string, unknown>) => this.store.append({ runId, at: new Date().toISOString(), type, data } satisfies RuntimeEvent);
        try {
          await symlink(path.join(this.root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
          if (mode === 'codex_code_graph' || mode === 'full_runtime') {
            const graphCommand = process.env.CODE_REVIEW_GRAPH_COMMAND ?? 'code-review-graph';
            const prefix = process.env.CODE_REVIEW_GRAPH_PREFIX_ARGS ? JSON.parse(process.env.CODE_REVIEW_GRAPH_PREFIX_ARGS) as string[] : [];
            const built = await command(graphCommand, [...prefix, 'build', '--repo', checkout], checkout, 120_000).catch(() => undefined);
            if (mode === 'codex_code_graph' && built?.code !== 0) throw new Error('code-review-graph build failed or is unavailable');
          }
          if (mode === 'full_runtime') {
            const lexical = new LexicalCodeContextProvider(checkout);
            const runtime = new SoftwareEngineeringRuntime({ context: new GraphCodeContextProvider(checkout, lexical), store: this.store,
              model: new CodexCliModel(checkout), control: new DeterministicControlPlane() }, { root: checkout });
            const result = await runtime.run(task);
            await this.store.append({ runId: result.runId, at: new Date().toISOString(), type: 'benchmark_mode', data: { mode, session } });
            results[mode] = result;
          } else {
            await emit('benchmark_mode', { mode, session });
            const model = new CodexCliModel(checkout);
            let prompt = task;
            if (mode === 'codex_superpowers') prompt += '\n\nWorkflow: reproduce or define the expected behavior, plan the edit, implement, run checks, and inspect the diff before completion.';
            if (mode === 'codex_code_graph') {
              const context = await new GraphCodeContextProvider(checkout, new LexicalCodeContextProvider(checkout)).getContext(task, [], 4000);
              if (context.source !== 'graph') throw new Error('code-review-graph is required for codex_code_graph benchmark mode');
              const compiled = new ContextCompiler().compile(task, context, [], 8000);
              prompt = compiled.prompt;
              await emit('context', { source: context.source, estimatedTokens: compiled.tokens });
            }
            const call = await model.run(prompt, { tier: 'standard' }, 'implementer');
            await emit('model_call', { role: 'implementer', tier: 'standard', inputTokens: call.inputTokens, outputTokens: call.outputTokens,
              cachedInputTokens: call.cachedInputTokens ?? 0, latencyMs: call.latencyMs, costUsd: call.costUsd });
            const checks: VerificationResult[] = await new VerificationEngine(checkout).run();
            for (const check of checks) await emit('verification', { ...check });
            const status = checks.every((check) => check.passed) ? 'accepted' : 'failed';
            await emit('outcome', { status, durationMs: call.latencyMs + checks.reduce((sum, check) => sum + check.durationMs, 0) });
            results[mode] = { status, verification: checks, modelCall: call };
          }
          await command('git', ['add', '-N', '.'], checkout, 10_000);
          const diff = await command('git', ['diff', 'HEAD', '--binary'], checkout, 10_000);
          const artifactDirectory = path.join(this.root, '.flowcheck', 'runtime', 'benchmarks', session);
          await mkdir(artifactDirectory, { recursive: true });
          await writeFile(path.join(artifactDirectory, `${mode}.patch`), diff.output, { mode: 0o600 });
        } catch (error) {
          results[mode] = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
          await emit('outcome', { status: 'failed', reason: String(error), durationMs: 0 });
        } finally {
          await command('git', ['worktree', 'remove', '--force', checkout], this.root, 30_000);
          if (previousGraphDir === undefined) delete process.env.CRG_DATA_DIR;
          else process.env.CRG_DATA_DIR = previousGraphDir;
        }
      }
      const events = (await this.store.read()).filter((event) => event.data.session === session ||
        (event.type === 'benchmark_mode' && event.data.session === session));
      const runIds = new Set(events.map((event) => event.runId));
      const all = (await this.store.read()).filter((event) => runIds.has(event.runId));
      return { session, results, metrics: compareBenchmarks(all) };
    } finally { await rm(workingDirectory, { recursive: true, force: true }); }
  }
}
