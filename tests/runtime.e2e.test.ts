import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { JsonlEventStore } from '../src/runtime/adapters.ts';
import { LexicalCodeContextProvider } from '../src/runtime/context.ts';
import { SoftwareEngineeringRuntime } from '../src/runtime/executor.ts';

const exec = promisify(execFile);

test('runtime runs on a real repository and persists a complete trajectory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-runtime-test-'));
  try {
    await exec('git', ['init', '-q'], { cwd: root });
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'browser.ts'), 'export function browserNavigation() { return true; }\n');
    await exec('git', ['add', 'src/browser.ts'], { cwd: root });
    await exec('git', ['-c', 'user.name=FlowCheck Test', '-c', 'user.email=flowcheck@example.test', 'commit', '-qm', 'fixture'], { cwd: root });
    const eventFile = path.join(root, '.flowcheck', 'runtime', 'events.jsonl');
    await writeFile(path.join(root, '.gitignore'), '.flowcheck/\n');
    await exec('git', ['add', '.gitignore'], { cwd: root });
    await exec('git', ['-c', 'user.name=FlowCheck Test', '-c', 'user.email=flowcheck@example.test', 'commit', '-qm', 'ignore events'], { cwd: root });
    const store = new JsonlEventStore(eventFile);
    const runtime = new SoftwareEngineeringRuntime({
      context: new LexicalCodeContextProvider(root), store,
      model: { run: async () => ({ output: 'Implemented', inputTokens: 12, outputTokens: 3, latencyMs: 1, costUsd: null }) },
      verifier: { run: async () => [{ name: 'unit', passed: true, exitCode: 0, durationMs: 1, output: 'ok' }] },
    }, { root, contextBudget: 1000 });
    const result = await runtime.run('Fix browser navigation bug');
    assert.equal(result.status, 'accepted');
    assert.deepEqual(result.selectedFiles, ['src/browser.ts']);
    const events = await store.read();
    assert.deepEqual(events.filter((event) => event.type === 'step' && event.data.status === 'completed').map((event) => event.data.id),
      ['inspect', 'implement', 'verify', 'impact', 'decision']);
    assert.equal(events.find((event) => event.type === 'outcome')?.data.status, 'accepted');
    assert.match(await readFile(eventFile, 'utf8'), /"model_call"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
