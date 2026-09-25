import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodingModel, ControlDecision, ControlPlane, EventStore, ModelConfig, ModelResult, RuntimeEvent, RuntimeState, VerificationResult } from './domain.ts';
import { DeterministicControlPlane } from './policy.ts';

export async function command(executable: string, args: string[], cwd: string, timeoutMs: number, input?: string): Promise<{ code: number | null; output: string; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: 'pipe', env: process.env });
    let output = '';
    let ended = false;
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-10_000_000); });
    child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-10_000_000); });
    child.on('error', (error) => { if (!ended) { ended = true; clearTimeout(timer); reject(error); } });
    child.on('close', (code) => { if (!ended) { ended = true; clearTimeout(timer); resolve({ code, output, durationMs: Date.now() - start }); } });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export class CodexCliModel implements CodingModel {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  async run(prompt: string, model: ModelConfig, role: 'planner' | 'implementer' | 'reviewer'): Promise<ModelResult> {
    const args = ['exec', '--json', '--ephemeral', '-C', this.root, '-s', role === 'implementer' ? 'workspace-write' : 'read-only', '--disable', 'collab'];
    if (model.model) args.push('-m', model.model);
    args.push('-');
    const result = await command('codex', args, this.root, 20 * 60_000, prompt);
    if (result.code !== 0) throw new Error(`Codex ${role} failed (${result.code}): ${result.output.slice(-2000)}`);
    let inputTokens = 0; let cachedInputTokens = 0; let outputTokens = 0; let output = '';
    for (const line of result.output.split('\n')) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
          const usage = event.usage as Record<string, unknown>;
          inputTokens += Number(usage.input_tokens ?? 0);
          cachedInputTokens += Number(usage.cached_input_tokens ?? 0);
          outputTokens += Number(usage.output_tokens ?? 0);
        }
        if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
          const item = event.item as Record<string, unknown>;
          if (item.type === 'agent_message' && typeof item.text === 'string') output = item.text;
        }
      } catch { /* non-JSON diagnostics */ }
    }
    cachedInputTokens = Math.min(cachedInputTokens, inputTokens);
    const costUsd = model.inputUsdPerMillion === undefined || model.outputUsdPerMillion === undefined ? null :
      ((inputTokens - cachedInputTokens) * model.inputUsdPerMillion + cachedInputTokens * (model.cachedInputUsdPerMillion ?? model.inputUsdPerMillion) +
        outputTokens * model.outputUsdPerMillion) / 1_000_000;
    return { output, inputTokens, cachedInputTokens, outputTokens, latencyMs: result.durationMs, costUsd };
  }
}

export class LayaHttpControlPlane implements ControlPlane {
  private readonly endpoint: string;
  private readonly fallback: ControlPlane;
  private readonly fetcher: typeof fetch;
  constructor(endpoint: string, fallback: ControlPlane = new DeterministicControlPlane(), fetcher: typeof fetch = fetch) {
    this.endpoint = endpoint; this.fallback = fallback; this.fetcher = fetcher;
  }
  async decide(state: RuntimeState): Promise<ControlDecision> {
    const base = await this.fallback.decide(state);
    if (base.action !== 'execute') return base;
    try {
      const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(3000), body: JSON.stringify({
        state: { task: state.task.text, task_type: state.task.type, changed_files: state.task.changedFiles, risk_features: state.context.riskFeatures },
        questions: {
          complexity: { type: 'choice', instructions: 'How complex is this software change?', criteria: { low: 'small local edit', medium: 'multiple related changes', high: 'architecture or broad impact' } },
          review: { type: 'noul', instructions: 'Does this change need independent code review?' },
        },
      }) });
      if (!response.ok) return base;
      const json = await response.json() as Record<string, unknown>;
      const answers = json.answers as Record<string, unknown> | undefined;
      const complexity = answers?.complexity as Record<string, unknown> | undefined;
      const review = answers?.review as Record<string, unknown> | undefined;
      const level = complexity?.choice;
      const reviewProbability = review?.noul;
      if (!['low', 'medium', 'high'].includes(String(level)) || typeof reviewProbability !== 'number') return base;
      const chosen = level as ControlDecision['complexity'];
      const levels = { low: 0, medium: 1, high: 2 };
      const effective = levels[chosen] > levels[base.complexity] ? chosen : base.complexity;
      return { ...base, complexity: effective, needPlanner: base.needPlanner || effective === 'high',
        needReview: base.needReview || reviewProbability >= 0.7,
        modelTier: effective === 'high' ? 'strong' : effective === 'medium' ? 'standard' : 'cheap', source: 'laya' };
    } catch { return base; }
  }
}

export class JsonlEventStore implements EventStore {
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  async append(event: RuntimeEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }
  async read(): Promise<RuntimeEvent[]> {
    const data = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
    return data.split('\n').filter(Boolean).map((line) => JSON.parse(line) as RuntimeEvent);
  }
}

export class VerificationEngine {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  async run(includeE2e = false): Promise<VerificationResult[]> {
    const checks = [['typecheck'], ['test:unit'], ...(includeE2e ? [['test:e2e']] : []), ['build']];
    const results: VerificationResult[] = [];
    for (const [script] of checks) {
      const result = await command('npm', ['run', script!], this.root, includeE2e && script === 'test:e2e' ? 10 * 60_000 : 3 * 60_000);
      results.push({ name: script!, passed: result.code === 0, exitCode: result.code, durationMs: result.durationMs, output: result.output.slice(-4000) });
      if (result.code !== 0) break;
    }
    return results;
  }
}
