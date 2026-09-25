import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import type { RunReport } from '../src/runner.ts';

async function quickstart(args: string[] = []) {
  const child = spawn(process.execPath, ['scripts/quickstart.mjs', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

async function reportFrom(stdout: string): Promise<RunReport> {
  const directory = stdout.match(/^Evidence: (.+)$/m)?.[1];
  assert.ok(directory, stdout);
  return JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
}

test('quickstart catches a broken form with the same scenario and saves failure evidence', async () => {
  const healthy = await quickstart();
  assert.equal(healthy.code, 0, healthy.stderr);
  const passed = await reportFrom(healthy.stdout);
  assert.equal(passed.status, 'passed');
  assert.equal(passed.steps.length, 6);

  const broken = await quickstart(['--broken']);
  assert.equal(broken.code, 1, broken.stderr);
  const failed = await reportFrom(broken.stdout);
  assert.deepEqual(failed.steps.slice(0, 4).map((step) => step.input), passed.steps.slice(0, 4).map((step) => step.input));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.stepId, 'confirmation');
  assert.deepEqual(failed.steps.map((step) => step.status), ['passed', 'passed', 'passed', 'passed', 'failed', 'skipped']);
  assert.equal(failed.steps.at(-1)?.id, 'welcome-url');

  const screenshot = failed.steps.find((step) => step.status === 'failed')?.screenshot;
  assert.ok(screenshot);
  const image = await readFile(path.join(failed.artifacts.directory, screenshot));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.ok(failed.artifacts.trace);
  assert.ok((await stat(path.join(failed.artifacts.directory, failed.artifacts.trace))).size > 0);
  assert.match(await readFile(path.join(failed.artifacts.directory, failed.artifacts.junit), 'utf8'), /failures="1"/);
});

test('quickstart chooses a free port when 4173 is occupied', async (t) => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const result = await quickstart();
  assert.equal(result.code, 0, result.stderr);
  const report = await reportFrom(result.stdout);
  assert.notEqual(report.baseUrl, 'http://127.0.0.1:4173');
  assert.equal(requests, 0);
});

test('quickstart rejects unknown flags before starting the demo', async () => {
  const result = await quickstart(['--brokn']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown option.*--brokn/);
  assert.doesNotMatch(result.stdout, /Demo:/);
});

test('quickstart explains demo modes without starting a browser', async () => {
  const result = await quickstart(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--headed/);
  assert.match(result.stdout, /--broken/);
  assert.doesNotMatch(result.stdout, /Demo:|Evidence:/);
  assert.equal(result.stderr, '');
});
