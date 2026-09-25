import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodeContext, CodingModel, ControlPlane, EventStore, RuntimeEvent, VerificationResult } from '../src/runtime/domain.ts';
import { ContextCompiler } from '../src/runtime/context.ts';
import { SoftwareEngineeringRuntime } from '../src/runtime/executor.ts';
import { aggregateMetrics, aggregateSkillAnalytics } from '../src/runtime/metrics.ts';
import { DeterministicControlPlane, SafetyPolicy, TaskCompiler, WorkflowCompiler } from '../src/runtime/policy.ts';
import { SkillRegistry, SkillRetriever } from '../src/runtime/skills.ts';
import { WorkflowExecutor } from '../src/runtime/workflow.ts';
import { LayaHttpControlPlane } from '../src/runtime/adapters.ts';

const context: CodeContext = { relevantFiles: ['src/runner.ts'], relevantSymbols: ['runScenario'], dependencies: [], callers: [], callees: [],
  tests: ['tests/runner.e2e.test.ts'], affectedFlows: [], riskFeatures: [], architectureContext: 'Browser runner', estimatedTokens: 10,
  snippets: [{ path: 'src/runner.ts', text: 'export function runScenario() {}', tokens: 8 }], source: 'lexical' };

test('task and workflow are deterministic', async () => {
  const task = new TaskCompiler().compile('Fix browser navigation bug');
  const decision = await new DeterministicControlPlane().decide({ task, context, attempt: 0 });
  assert.equal(task.type, 'bugfix');
  assert.equal(decision.needReview, false);
  assert.deepEqual(new WorkflowCompiler().compile(task, context, decision).steps.map((step) => step.id), ['inspect', 'implement', 'verify', 'impact', 'decision']);
});

test('skill dependencies fit in budget and cycles fail', async () => {
  const registry = new SkillRegistry([
    { id: 'base', description: '', triggers: [], requires: [], dependencies: [], inputs: [], outputs: [], tools: [], verification: [], risk: 'low', estimatedTokens: 4, instructions: 'base' },
    { id: 'fix', description: '', triggers: ['bug'], requires: [], dependencies: ['base'], inputs: [], outputs: [], tools: [], verification: [], risk: 'low', estimatedTokens: 5, instructions: 'fix' },
  ]);
  const retriever = new SkillRetriever(registry);
  assert.deepEqual((await retriever.retrieve('bug', context, 9)).map((skill) => skill.id), ['base', 'fix']);
  assert.deepEqual(await retriever.retrieve('bug', context, 8), []);
  registry.add({ ...registry.get('fix')!, id: 'cycle', dependencies: ['cycle'] });
  await assert.rejects(() => retriever.retrieve('cycle bug', context, 20), /cycle/);
});

test('project skill manifest loads with typed fields', async () => {
  const registry = await SkillRegistry.load(new URL('../runtime-skills/', import.meta.url).pathname);
  assert.equal(registry.get('browser-regression')?.dependencies[0], 'verification-before-completion');
});

test('context budget leaves room for reasoning and output', () => {
  const compiled = new ContextCompiler().compile('Fix bug', { ...context, snippets: [{ path: 'huge.ts', text: 'x'.repeat(10000), tokens: 2500 }] }, [], 1000);
  assert.ok(compiled.tokens < 620);
  assert.deepEqual(compiled.selectedFiles, []);
  assert.throws(() => new ContextCompiler().compile('x'.repeat(3000), context, [], 1000), /exceeds the context budget/);
});

test('workflow executor follows dependencies and rejects invalid graphs', async () => {
  const order: string[] = [];
  await new WorkflowExecutor().execute({ steps: [
    { id: 'b', kind: 'verify', required: true, dependsOn: ['a'] },
    { id: 'a', kind: 'implement', required: true, dependsOn: [] },
  ] }, async (step) => { order.push(step.id); });
  assert.deepEqual(order, ['a', 'b']);
  await assert.rejects(() => new WorkflowExecutor().execute({ steps: [{ id: 'a', kind: 'inspect', required: true, dependsOn: ['missing'] }] }, async () => {}), /cycle or missing/);
});

test('Laya can raise risk and falls back on failure', async () => {
  const task = new TaskCompiler().compile('Add a small feature');
  const state = { task, context, attempt: 0 };
  const laya = new LayaHttpControlPlane('http://local.test/predict', new DeterministicControlPlane(),
    (async () => new Response(JSON.stringify({ answers: { complexity: { choice: 'high' }, review: { noul: 0.9 } } }), { status: 200 })) as typeof fetch);
  const decision = await laya.decide(state);
  assert.equal(decision.source, 'laya');
  assert.equal(decision.needPlanner, true);
  assert.equal(decision.needReview, true);
  const failed = new LayaHttpControlPlane('http://local.test/predict', new DeterministicControlPlane(),
    (async () => { throw new Error('offline'); }) as typeof fetch);
  assert.equal((await failed.decide(state)).source, 'policy');
});

test('skill analytics aggregate outcomes and model telemetry', () => {
  const at = new Date(0).toISOString();
  const events: RuntimeEvent[] = [
    { runId: '1', at, type: 'skills', data: { ids: ['debug'] } },
    { runId: '1', at, type: 'model_call', data: { inputTokens: 100, outputTokens: 20, costUsd: 0.02, latencyMs: 50 } },
    { runId: '1', at, type: 'outcome', data: { status: 'accepted' } },
    { runId: '2', at, type: 'skills', data: { ids: ['debug'] } },
    { runId: '2', at, type: 'outcome', data: { status: 'escalated' } },
  ];
  assert.equal(aggregateSkillAnalytics(events).debug?.successRate, 0.5);
  assert.equal(aggregateSkillAnalytics(events).debug?.humanInterventionRate, 0.5);
  assert.equal(aggregateSkillAnalytics(events).debug?.avgCostUsd, null);
});

test('safety gates risky requests before model invocation', async () => {
  assert.ok(new SafetyPolicy().assess('git push --force to main').includes('force push'));
  assert.ok(new SafetyPolicy().assessPatch('M\tmigrations/001.sql', '+++ b/migrations/001.sql\n+DROP TABLE users;').includes('destructive database migration'));
  assert.ok(new SafetyPolicy().assessPatch('A\t.env.production', '').includes('secret file change'));
  let calls = 0;
  const model: CodingModel = { run: async () => { calls++; return { output: '', inputTokens: 1, outputTokens: 1, latencyMs: 1, costUsd: null }; } };
  const events: RuntimeEvent[] = [];
  const store: EventStore = { append: async (event) => { events.push(event); }, read: async () => events };
  const runtime = new SoftwareEngineeringRuntime({ context: { getContext: async () => context }, model, store }, { root: process.cwd() });
  const result = await runtime.run('Deploy to production');
  assert.equal(result.status, 'blocked');
  assert.equal(calls, 0);
});

test('successful run records steps, tokens and verification', async () => {
  const events: RuntimeEvent[] = [];
  const store: EventStore = { append: async (event) => { events.push(event); }, read: async () => events };
  const model: CodingModel = { run: async () => ({ output: 'Done', inputTokens: 50, outputTokens: 10, latencyMs: 3, costUsd: 0.01 }) };
  const verification: VerificationResult[] = [{ name: 'unit', passed: true, exitCode: 0, durationMs: 1, output: 'ok' }];
  const runtime = new SoftwareEngineeringRuntime({ context: { getContext: async () => context }, model, store, verifier: { run: async () => verification } },
    { root: process.cwd(), enableSkillGraph: false, requireCleanWorktree: false });
  const result = await runtime.run('Fix browser navigation bug');
  assert.equal(result.status, 'accepted');
  assert.equal(result.modelCalls, 1);
  assert.equal(result.inputTokens, 50);
  assert.ok(events.some((event) => event.type === 'verification'));
  assert.equal(aggregateMetrics(events).costPerSuccessfulTaskUsd, 0.01);
});
