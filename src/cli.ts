#!/usr/bin/env node
import { appendFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { installBrowser, ensureBrowser } from './browser.ts';
import { pageScenario } from './check.ts';
import { connect } from './connect.ts';
import { runDemo } from './demo.ts';
import { releasePackage, version } from './package.ts';
import { loadScenario, runScenario, type RunReport } from './runner.ts';
import { runSuite, type SuiteReport } from './suite.ts';
import { markdownErrorSummary, markdownSummary } from './summary.ts';

function help(): void {
  process.stdout.write(`
FlowCheck Local ${version}

Browser checks for you and your coding agent. No account or API key required.

Usage:
  flowcheck check <url> [--text <expected text>] [--headed] [--json]
  flowcheck demo [--headed] [--broken] [--json]
  flowcheck init [scenario.json] [--url <url>]
  flowcheck validate <scenario.json> [--json]
  flowcheck run [scenario.json|directory|glob] [--base-url <url>] [--headed] [--output <directory>] [--summary <file>] [--json]
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

function printReport(report: RunReport | SuiteReport, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else if ('cases' in report) {
    process.stdout.write(`FlowCheck suite: ${report.counts.scenarios} scenarios · ${report.counts.passed} passed · ${report.counts.failed} failed · ${report.counts.errored} errored · ${report.counts.skipped} skipped\n`);
    for (const entry of report.cases) process.stdout.write(`${entry.status} ${entry.file}${entry.error ? `: ${entry.error}` : ''}\n`);
    process.stdout.write(`Evidence: ${report.artifacts.directory}\n`);
  }
  else {
    process.stdout.write(`\nFlowCheck · ${report.scenario.name}\nTarget: ${report.baseUrl}\nSteps:  ${report.steps.length}\n\n`);
    for (const step of report.steps) {
      process.stdout.write(`${step.status === 'passed' ? '✓' : step.status === 'skipped' ? '–' : '✗'} ${step.id} · ${step.action} · ${step.status} · ${step.durationMs}ms\n`);
    }
    process.stdout.write(`\n${report.status.toUpperCase()} · ${report.durationMs}ms\nEvidence: ${report.artifacts.directory}\n`);
    if (report.error) process.stdout.write(`Error: ${report.error.message}\n`);
  }
  if (report.status === 'failed') process.exitCode = 1;
  if (report.status === 'errored') process.exitCode = 2;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    headed: { type: 'boolean' }, broken: { type: 'boolean' }, json: { type: 'boolean' },
    output: { type: 'string' }, url: { type: 'string' }, text: { type: 'string' },
    'base-url': { type: 'string' }, summary: { type: 'string' },
    workspace: { type: 'string' }, 'with-deps': { type: 'boolean' },
  } });
  if (values.version) { process.stdout.write(`${version}\n`); return; }
  const [command, argument, ...extra] = positionals;
  if (values.help || !command || command === 'help') { help(); return; }
  if (extra.length) throw new Error('Too many arguments. Run flowcheck --help.');
  const allowed: Record<string, string[]> = {
    setup: ['with-deps'], mcp: ['workspace'], config: ['workspace'], connect: ['workspace'],
    init: ['url', 'text'], demo: ['headed', 'broken', 'json', 'output'],
    check: ['headed', 'json', 'output', 'text'], validate: ['json'],
    run: ['headed', 'json', 'output', 'base-url', 'summary'],
  };
  for (const [flag, value] of Object.entries(values)) {
    if (value !== undefined && !['help', 'version'].includes(flag) && !allowed[command]?.includes(flag)) throw new Error(`--${flag} is not valid for ${command}`);
  }
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
    if (command === 'validate') {
      const scenario = await loadScenario(scenarioFile);
      process.stdout.write(json ? `${JSON.stringify({ valid: true, name: scenario.name, steps: scenario.steps.length })}\n` : `✓ ${scenario.name}: ${scenario.steps.length} steps are valid\n`);
      return;
    }
    const directory = await stat(scenarioFile).then((info) => info.isDirectory()).catch(() => false);
    const report = /[*?]/.test(argument ?? '') || directory
      ? await runSuite(scenarioFile, { headed: values.headed, outputDir: values.output, baseUrl: values['base-url'] })
      : await runScenario(await loadScenario(scenarioFile), { scenarioFile, headed: values.headed, outputDir: values.output, baseUrl: values['base-url'] });
    if (values.summary) await appendFile(path.resolve(values.summary), markdownSummary(report));
    printReport(report, json);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run flowcheck --help.`);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const summaryAt = process.argv.indexOf('--summary');
  if (summaryAt >= 0 && process.argv[summaryAt + 1]) {
    await appendFile(path.resolve(process.argv[summaryAt + 1]!), markdownErrorSummary(message)).catch((writeError) => {
      process.stderr.write(`Could not write FlowCheck summary: ${writeError instanceof Error ? writeError.message : String(writeError)}\n`);
    });
  }
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ status: 'error', error: message })}\n`);
  else process.stderr.write(`FlowCheck error: ${message}\n`);
  process.exitCode = 2;
});
