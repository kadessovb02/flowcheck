import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flowcheck-package-')));
const project = path.join(temp, 'unrelated project');
await mkdir(project);
let packageServer;
try {
  const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', temp], { maxBuffer: 4_000_000 });
  const [pack] = JSON.parse(stdout);
  for (const file of pack.files) {
    assert.ok(!/^(src\/|tests\/|\.flowcheck\/)|launch-plan|private-notes/.test(file.path), file.path);
  }
  const archive = path.join(temp, pack.filename);
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  // Exercise exactly the no-clone invocation users run, from an unrelated project.
  const bytes = await readFile(archive);
  packageServer = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(bytes);
  });
  await new Promise((resolve) => packageServer.listen(0, '127.0.0.1', resolve));
  const packageUrl = `http://127.0.0.1:${packageServer.address().port}/flowcheck.tgz`;
  const invocation = ['--yes', '--cache', path.join(temp, 'npm-cache'), packageUrl];
  const result = await exec('npx', [...invocation, 'demo', '--json'], { cwd: project, maxBuffer: 4_000_000, env: process.env.FLOWCHECK_TEST_FRESH_BROWSER === '1' ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(temp, 'browser-cache') } : process.env });
  if (process.env.FLOWCHECK_TEST_FRESH_BROWSER === '1') assert.match(result.stderr, /downloading Chromium for the first run/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed');
  assert.equal(report.steps.length, 6);
  assert.ok(report.artifacts.directory.startsWith(project));
  assert.equal((await exec('npx', [...invocation, '--version'], { cwd: project })).stdout.trim(), version);
  const client = new Client({ name: 'package-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: 'npx', args: [...invocation, 'mcp', '--workspace', project], stderr: 'pipe' }));
    const result = await client.callTool({ name: 'flowcheck_validate_scenario', arguments: { scenario: {
      version: 1, name: 'Packed MCP', baseUrl: 'http://localhost:3000', steps: [{ id: 'open', action: 'goto', path: '/' }],
    } } });
    assert.equal(result.isError, false);
  } finally { await client.close(); }
  await exec('npm', ['install', '--save-dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(temp, 'npm-cache'), packageUrl], { cwd: project });
  assert.equal((await exec('npx', ['--no-install', '--', 'flowcheck', '--version'], { cwd: project })).stdout.trim(), version);
  const checks = path.join(project, 'checks');
  await mkdir(checks);
  const scenario = { version: 1, name: 'Packed suite', baseUrl: 'http://localhost:9', evidence: { screenshots: 'off', trace: false }, steps: [
    { id: 'open', action: 'goto', path: '/' }, { id: 'text', action: 'assertText', text: 'Package app' }, { id: 'url', action: 'assertUrl', pattern: '/' },
  ] };
  await writeFile(path.join(checks, 'first.json'), JSON.stringify(scenario));
  const app = http.createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<p>Package app</p>'); });
  try {
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${app.address().port}`;
    const suite = await exec('npx', ['--no-install', 'flowcheck', 'run', 'checks/*.json', '--base-url', baseUrl, '--json'], { cwd: project });
    const report = JSON.parse(suite.stdout);
    assert.equal(report.kind, 'suite');
    assert.equal(report.counts.passed, 1);
    assert.equal(report.cases[0].report.baseUrl, baseUrl);
    assert.match(await readFile(path.join(report.artifacts.directory, 'junit.xml'), 'utf8'), /testsuites/);
  } finally { await new Promise((resolve) => app.close(resolve)); }
  console.log('Packed release verified: npx demo, installed suite with base URL override, version, and MCP work outside the repository.');
} finally {
  if (packageServer) await new Promise((resolve) => packageServer.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
