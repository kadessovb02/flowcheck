import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runScenario } from '../src/runner.ts';

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
