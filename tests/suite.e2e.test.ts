import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSuite, resolveScenarioFiles } from '../src/suite.ts';

test('suite sorts files, isolates contexts, continues after failures and invalid files, and applies base URL override', async (t) => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url === '/set') response.end('<script>document.cookie="suite=dirty"</script><p>Set</p>');
    else response.end(`<p>${request.headers.cookie ? 'Dirty' : 'Clean'}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-suite-'));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const scenario = (name: string, steps: unknown[]) => ({ version: 1, name, baseUrl: 'http://localhost:9', timeoutMs: 500,
    evidence: { screenshots: 'off', trace: false }, steps });
  await writeFile(path.join(directory, '01-set.json'), JSON.stringify(scenario('Set', [{ id: 'open', action: 'goto', path: '/set' }])));
  await writeFile(path.join(directory, '02-fail.json'), JSON.stringify(scenario('Fail', [
    { id: 'open', action: 'goto', path: '/' }, { id: 'missing', action: 'assertUrl', pattern: '/missing' },
  ])));
  await writeFile(path.join(directory, '03-invalid.json'), JSON.stringify({ bad: true }));
  await writeFile(path.join(directory, '04-clean.json'), JSON.stringify(scenario('Clean', [
    { id: 'open', action: 'goto', path: '/' }, { id: 'text', action: 'assertText', text: 'Clean' },
    { id: 'url', action: 'assertUrl', pattern: '/' },
  ])));
  assert.equal((await resolveScenarioFiles(path.join(directory, '**/*.json'))).length, 4);
  const result = await runSuite(path.join(directory, '*.json'), { outputDir: path.join(directory, 'out'), baseUrl });
  assert.deepEqual(result.cases.map((entry) => entry.status), ['passed', 'failed', 'errored', 'passed']);
  assert.deepEqual(result.counts, { scenarios: 4, passed: 2, failed: 1, errored: 1, skipped: 0 });
  assert.equal(result.status, 'errored');
  assert.equal(result.cases[3]?.report?.baseUrl, baseUrl);
  assert.ok(result.cases[3]?.report?.scenario.sourceSha256);
  const junit = await readFile(path.join(result.artifacts.directory, result.artifacts.junit), 'utf8');
  assert.match(junit, /<failure/);
  assert.match(junit, /<error/);
  assert.notEqual(result.cases[0]?.report?.runId, result.cases[3]?.report?.runId);
  const summary = path.join(directory, 'summary.md');
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'run', path.join(directory, '*.json'), '--base-url', baseUrl, '--output', path.join(directory, 'cli-out'), '--summary', summary, '--json']);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (part) => { stdout += part.toString(); });
  child.stderr.on('data', (part) => { stderr += part.toString(); });
  const status = await new Promise<number | null>((resolve) => child.once('close', resolve));
  const cli = { status, stdout, stderr };
  assert.equal(cli.status, 2, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).counts.errored, 1);
  const markdown = await readFile(summary, 'utf8');
  assert.match(markdown, /Scenarios: 4/);
  assert.match(markdown, /Expected:/);
});

test('empty scenario glob is an error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-empty-'));
  await assert.rejects(runSuite(path.join(directory, '*.json')), /No scenario JSON files matched/);
  const cli = spawnSync(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'run', path.join(directory, '*.json'), '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.match(cli.stdout, /No scenario JSON files matched/);
  const ignoredFlag = spawnSync(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'validate', 'missing.json', '--base-url', 'http://localhost:3000'], { encoding: 'utf8' });
  assert.equal(ignoredFlag.status, 2);
  assert.match(ignoredFlag.stderr, /--base-url is not valid for validate/);
});
