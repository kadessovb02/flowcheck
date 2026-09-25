#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { CodexCliModel, JsonlEventStore, LayaHttpControlPlane } from './adapters.ts';
import { loadRuntimeConfig } from './config.ts';
import { GraphCodeContextProvider, LexicalCodeContextProvider } from './context.ts';
import { SoftwareEngineeringRuntime } from './executor.ts';
import { aggregateMetrics, compareBenchmarks } from './metrics.ts';
import { DeterministicControlPlane, ModelRouter } from './policy.ts';
import { BenchmarkRunner, BENCHMARK_MODES, type BenchmarkMode } from './benchmark.ts';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: 'string' }, json: { type: 'boolean' }, e2e: { type: 'boolean' }, mode: { type: 'string' },
    serve: { type: 'boolean' }, port: { type: 'string' },
  } });
  const [action, ...words] = positionals;
  const root = path.resolve(values.workspace ?? process.cwd());
  const config = loadRuntimeConfig(root);
  const store = new JsonlEventStore(path.join(root, '.flowcheck', 'runtime', 'events.jsonl'));
  if (action === 'metrics') {
    if (!values.serve) { process.stdout.write(`${JSON.stringify(aggregateMetrics(await store.read()), null, 2)}\n`); return; }
    const port = Number(values.port ?? 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1..65535');
    const server = createServer(async (request, response) => {
      if (request.url !== '/metrics') { response.writeHead(404).end(); return; }
      try { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(aggregateMetrics(await store.read()))); }
      catch { response.writeHead(500).end(); }
    });
    server.listen(port, '127.0.0.1', () => process.stderr.write(`Runtime metrics: http://127.0.0.1:${port}/metrics\n`));
    return;
  }
  if (action === 'benchmark') { process.stdout.write(`${JSON.stringify(compareBenchmarks(await store.read()), null, 2)}\n`); return; }
  if (action === 'benchmark-run' && words.length) {
    const mode = values.mode;
    if (mode && !BENCHMARK_MODES.includes(mode as BenchmarkMode)) throw new Error(`Unknown benchmark mode: ${mode}`);
    const result = await new BenchmarkRunner(root, store).run(words.join(' '), mode ? [mode as BenchmarkMode] : BENCHMARK_MODES);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (Object.values(result.results as Record<string, { status?: string }>).some((entry) => entry.status !== 'accepted')) process.exitCode = 1;
    return;
  }
  if (!['plan', 'run'].includes(action ?? '') || !words.length) {
    process.stdout.write('Usage: flowcheck-runtime <plan|run> <task> [--workspace dir] [--e2e]\n       flowcheck-runtime benchmark-run <task> [--mode mode] [--workspace dir]\n       flowcheck-runtime <metrics|benchmark> [--workspace dir]\n       flowcheck-runtime metrics --serve [--port 8787]\n');
    if (action) process.exitCode = 2;
    return;
  }
  const lexical = new LexicalCodeContextProvider(root);
  const context = config.enableCodeGraph ? new GraphCodeContextProvider(root, lexical) : lexical;
  const runtime = new SoftwareEngineeringRuntime({ context, store, model: new CodexCliModel(root),
    control: config.enableLaya ? new LayaHttpControlPlane(config.layaUrl) : new DeterministicControlPlane(),
    router: new ModelRouter(config.models) }, { root, contextBudget: config.contextBudget, enableSkillGraph: config.enableSkillGraph,
    enableExperienceStore: config.enableExperienceStore, enableAdaptiveRouting: config.enableAdaptiveRouting, includeE2e: values.e2e });
  const result = action === 'plan' ? await runtime.plan(words.join(' ')) : await runtime.run(words.join(' '));
  process.stdout.write(`${JSON.stringify(result, null, values.json ? 0 : 2)}\n`);
  if (action === 'run' && 'status' in result && result.status !== 'accepted') process.exitCode = 1;
}

main().catch((error: unknown) => { process.stderr.write(`Runtime error: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
