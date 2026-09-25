import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runScenario } from '../src/runner.ts';
import type { Browser } from 'playwright';

test('runs a real Chromium scenario and writes redacted evidence', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><form id="form"><label for="secret">Password</label><input id="secret"><button>Continue</button></form><p role="status" hidden>Signed in</p><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();document.querySelector('[role=status]').hidden=false;history.pushState({},'', '/done')})</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-oss-'));
  process.env.FLOWCHECK_TEST_PASSWORD = 'do-not-write-this-value';
  t.after(() => { delete process.env.FLOWCHECK_TEST_PASSWORD; });

  const report = await runScenario({
    version: 1,
    name: 'Local login',
    baseUrl: `http://127.0.0.1:${address.port}`,
    evidence: { screenshots: 'always', trace: true, mask: [{ label: 'Password' }] },
    steps: [
      { id: 'open', action: 'goto', path: '/' },
      { id: 'password', action: 'fill', target: { label: 'Password' }, valueFromEnv: 'FLOWCHECK_TEST_PASSWORD', sensitive: true },
      { id: 'continue', action: 'click', target: { role: 'button', name: 'Continue' } },
      { id: 'signed-in', action: 'assertText', text: 'Signed in', exact: true },
      { id: 'done-url', action: 'assertUrl', pattern: `http://127.0.0.1:${address.port}/done` },
    ],
  }, { outputDir });

  assert.equal(report.status, 'passed');
  assert.equal(report.steps.length, 5);
  assert.ok(report.artifacts.trace);
  const serialized = await readFile(path.join(report.artifacts.directory, 'report.json'), 'utf8');
  assert.doesNotMatch(serialized, /do-not-write-this-value/);
  assert.match(await readFile(path.join(report.artifacts.directory, 'junit.xml'), 'utf8'), /testsuite/);
});

test('assertUrl waits for a delayed history transition and times out when it never occurs', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<button id="later">Later</button><script>document.querySelector("button").onclick=()=>setTimeout(()=>history.pushState({},"","/done"),180)</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-url-'));
  const passed = await runScenario({ version: 1, name: 'Delayed route', baseUrl, timeoutMs: 1_000, steps: [
    { id: 'open', action: 'goto', path: '/' },
    { id: 'later', action: 'click', target: { role: 'button', name: 'Later' } },
    { id: 'url', action: 'assertUrl', pattern: `${baseUrl}/done` },
  ] }, { outputDir });
  assert.equal(passed.status, 'passed');
  const failed = await runScenario({ version: 1, name: 'Missing route', baseUrl, timeoutMs: 500, steps: [
    { id: 'open', action: 'goto', path: '/' },
    { id: 'url', action: 'assertUrl', pattern: `${baseUrl}/never` },
    { id: 'not-run', action: 'assertText', text: 'Never' },
  ] }, { outputDir });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.steps.map((step) => step.status), ['passed', 'failed', 'skipped']);
  assert.equal(failed.steps[1]?.error?.expected, `${baseUrl}/never`);
  assert.equal(failed.steps[1]?.error?.actual, `${baseUrl}/`);
  assert.match(await readFile(path.join(failed.artifacts.directory, 'junit.xml'), 'utf8'), /<skipped\/>/);
});

test('assertText is visible, unique, and optionally scoped', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<section id="wrong"><p>Old result</p></section><section id="right"><p>Ready</p></section><p hidden>Ready</p><p class="duplicate">Duplicate</p><p class="duplicate">Duplicate</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-text-'));
  const run = (name: string, step: { id: string; action: 'assertText'; text: string; exact: boolean; target?: { css: string } }) => runScenario({
    version: 1, name, baseUrl, timeoutMs: 500, steps: [{ id: 'open', action: 'goto', path: '/' }, step],
  }, { outputDir });
  assert.equal((await run('Visible match', { id: 'text', action: 'assertText', text: 'Ready', exact: true, target: { css: '#right' } })).status, 'passed');
  assert.equal((await run('Hidden plus visible', { id: 'text', action: 'assertText', text: 'Ready', exact: true })).status, 'passed');
  assert.equal((await run('Wrong scope', { id: 'text', action: 'assertText', text: 'Ready', exact: true, target: { css: '#wrong' } })).status, 'failed');
  assert.equal((await run('Duplicate match', { id: 'text', action: 'assertText', text: 'Duplicate', exact: true })).status, 'failed');
});

test('browser preparation errors produce an errored report and skipped steps', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-infra-'));
  const browser = { newContext: async () => { throw new Error('Browser unavailable'); } } as unknown as Browser;
  const report = await runScenario({ version: 1, name: 'Infra', baseUrl: 'http://localhost:3000', steps: [
    { id: 'open', action: 'goto', path: '/' }, { id: 'text', action: 'assertText', text: 'Ready' },
  ] }, { outputDir, browser });
  assert.equal(report.status, 'errored');
  assert.deepEqual(report.steps.map((step) => step.status), ['skipped', 'skipped']);
  assert.match(await readFile(path.join(report.artifacts.directory, 'junit.xml'), 'utf8'), /<error/);
});
