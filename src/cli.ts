#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { installBrowser, ensureBrowser } from './browser.ts';
import { pageScenario } from './check.ts';
import { connect } from './connect.ts';
import { runDemo } from './demo.ts';
import { releasePackage, version } from './package.ts';
import { loadScenario, runScenario, type RunReport } from './runner.ts';

function help(): void {
  process.stdout.write(`
FlowCheck Local ${version}

Browser checks for you and your coding agent. No account or API key required.

Usage:
  flowcheck check <url> [--text <expected text>] [--headed] [--json]
  flowcheck demo [--headed] [--broken] [--json]
  flowcheck init [scenario.json] [--url <url>]
  flowcheck validate <scenario.json> [--json]
  flowcheck run [scenario.json] [--headed] [--output <directory>] [--json]
  flowcheck connect <codex|claude> [--workspace <directory>]
  flowcheck config [--workspace <directory>]
  flowcheck mcp [--workspace <directory>]
  flowcheck setup [--with-deps]
  flowcheck --version

Chromium downloads automatically on the first browser run and is then cached.
Evidence is saved in .flowcheck/runs/ in your current project.
--broken deliberately fails the demo with exit code 1.
check verifies page loading and optional text, not every user journey.
No telemetry is collected. Run only against systems you are authorized to test.
`);
}

function printReport(report: RunReport, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    process.stdout.write(`\nFlowCheck · ${report.scenario.name}\nTarget: ${report.baseUrl}\nSteps:  ${report.steps.length}\n\n`);
    for (const step of report.steps) {
      process.stdout.write(`${step.status === 'passed' ? '✓' : '✗'} ${step.id} · ${step.action} · ${step.durationMs}ms\n`);
    }
    process.stdout.write(`\n${report.status.toUpperCase()} · ${report.durationMs}ms\nEvidence: ${report.artifacts.directory}\n`);
    if (report.error) process.stdout.write(`Error: ${report.error.message}\n`);
  }
  if (report.status === 'failed') process.exitCode = 1;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    headed: { type: 'boolean' }, broken: { type: 'boolean' }, json: { type: 'boolean' },
    output: { type: 'string' }, url: { type: 'string' }, text: { type: 'string' },
    workspace: { type: 'string' }, 'with-deps': { type: 'boolean' },
  } });
  if (values.version) { process.stdout.write(`${version}\n`); return; }
  const [command, argument, ...extra] = positionals;
  if (values.help || !command || command === 'help') { help(); return; }
  if (extra.length) throw new Error('Too many arguments. Run flowcheck --help.');
  const json = values.json ?? false;
  const workspace = path.resolve(values.workspace ?? process.cwd());
  if (command === 'setup') { await installBrowser(values['with-deps']); return; }
  if (command === 'mcp') {
    process.env.FLOWCHECK_WORKSPACE_ROOT = values.workspace ? workspace : process.env.FLOWCHECK_WORKSPACE_ROOT ?? workspace;
    await import('./mcp.ts');
    return;
  }
  if (command === 'config') {
    process.stdout.write(`${JSON.stringify({ mcpServers: { flowcheck: {
      command: 'npx', args: ['--yes', releasePackage, 'mcp', '--workspace', workspace],
    } } }, null, 2)}\n`);
    return;
  }
  if (command === 'connect') {
    if (!argument || !['codex', 'claude'].includes(argument)) throw new Error('Choose a client: flowcheck connect codex or flowcheck connect claude.');
    await ensureBrowser();
    await connect(argument, workspace);
    return;
  }
  if (command === 'init') {
    const destination = path.resolve(argument ?? 'flowcheck.scenario.json');
    const sample = pageScenario(values.url ?? 'http://127.0.0.1:3000', values.text);
    await writeFile(destination, `${JSON.stringify(sample, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Created ${destination}\nRun it with: flowcheck run ${JSON.stringify(destination)}\n`);
    return;
  }
  if (command === 'demo') {
    printReport(await runDemo({ headed: values.headed, broken: values.broken, outputDir: values.output }), json);
    return;
  }
  if (command === 'check') {
    if (!argument) throw new Error('Usage: flowcheck check <url> [--text <expected text>]');
    printReport(await runScenario(pageScenario(argument, values.text), { headed: values.headed, outputDir: values.output }), json);
    return;
  }
  if (command === 'validate' || command === 'run') {
    if (command === 'validate' && !argument) throw new Error('validate requires a scenario file');
    const scenarioFile = path.resolve(argument ?? 'flowcheck.scenario.json');
    const scenario = await loadScenario(scenarioFile);
    if (command === 'validate') {
      process.stdout.write(json ? `${JSON.stringify({ valid: true, name: scenario.name, steps: scenario.steps.length })}\n` : `✓ ${scenario.name}: ${scenario.steps.length} steps are valid\n`);
      return;
    }
    printReport(await runScenario(scenario, { scenarioFile, headed: values.headed, outputDir: values.output }), json);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run flowcheck --help.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ status: 'error', error: message })}\n`);
  else process.stderr.write(`FlowCheck error: ${message}\n`);
  process.exitCode = 2;
});
