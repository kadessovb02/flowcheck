import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, readFile, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const cli = path.resolve('src/cli.ts');
async function run(args: string[], cwd: string) {
  try {
    const result = await exec(process.execPath, ['--experimental-strip-types', cli, ...args], { cwd });
    return { code: 0, ...result };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return result;
  }
}

test('standalone URL check works outside the repo and rejects HTTP failures', async (t) => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flowcheck-check-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
    res.end('<h1>Ready to ship</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const passed = await run(['check', url, '--text', 'Ready to ship', '--json'], directory);
  assert.equal(passed.code, 0, passed.stderr);
  const report = JSON.parse(passed.stdout);
  assert.equal(report.status, 'passed');
  assert.equal(report.steps.length, 3);
  assert.ok(report.artifacts.directory.startsWith(directory));
  const failed = await run(['check', `${url}/missing`, '--json'], directory);
  assert.equal(failed.code, 1, failed.stderr);
  assert.match(JSON.parse(failed.stdout).error.message, /HTTP 404/);
  const invalid = await run(['check', 'file:///etc/passwd', '--json'], directory);
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stdout).status, 'error');
});

test('init creates a usable URL scenario without overwriting existing files', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await run(['init', '--url', 'http://localhost:8080/settings'], directory);
  assert.equal(first.code, 0, first.stderr);
  const filename = path.join(directory, 'flowcheck.scenario.json');
  const original = await readFile(filename, 'utf8');
  assert.equal(JSON.parse(original).baseUrl, 'http://localhost:8080/settings');
  assert.equal((await run(['init'], directory)).code, 2);
  assert.equal(await readFile(filename, 'utf8'), original);
});

test('MCP accepts inline journeys and canonicalizes a symlinked workspace', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-inline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  const actualWorkspace = path.join(directory, 'project');
  await mkdir(actualWorkspace);
  await symlink(actualWorkspace, workspace);
  const scenario = { version: 1, name: 'Inline check', baseUrl: 'http://localhost:3000', steps: [{ id: 'open', action: 'goto', path: '/' }] };
  await writeFile(path.join(actualWorkspace, 'scenario.json'), JSON.stringify(scenario));
  await writeFile(path.join(directory, 'outside.json'), JSON.stringify(scenario));
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--experimental-strip-types', cli, 'mcp', '--workspace', workspace],
    env: getDefaultEnvironment(), stderr: 'pipe',
  });
  const client = new Client({ name: 'onboarding-test', version: '1' });
  await client.connect(transport);
  t.after(() => client.close());
  for (const args of [{ scenario }, { scenarioPath: 'scenario.json' }]) {
    const result = await client.callTool({ name: 'flowcheck_validate_scenario', arguments: args });
    assert.equal(result.isError, false);
  }
  const ambiguous = await client.callTool({ name: 'flowcheck_validate_scenario', arguments: { scenario, scenarioPath: 'scenario.json' } });
  assert.equal(ambiguous.isError, true);
  const escape = await client.callTool({ name: 'flowcheck_validate_scenario', arguments: { scenarioPath: '../outside.json' } });
  assert.equal(escape.isError, true);
  assert.match(JSON.stringify(escape.content), /inside FLOWCHECK_WORKSPACE_ROOT/);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>Inline MCP works</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const checked = await client.callTool({ name: 'flowcheck_check_page', arguments: { url, text: 'Inline MCP works' } });
  assert.equal(checked.isError, false);
  const ran = await client.callTool({ name: 'flowcheck_run_scenario', arguments: { scenario: { ...scenario, baseUrl: url } } });
  assert.equal(ran.isError, false);
  const content = ran.content as { type: string; text: string }[];
  assert.equal(JSON.parse(content[0]!.text).status, 'passed');
});
