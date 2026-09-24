#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadScenario, runScenario } from './runner.ts';
import { ScenarioValidationError, validateScenario } from './schema.ts';

const VERSION = '0.1.0';

const sample = {
  version: 1,
  name: 'My first FlowCheck',
  baseUrl: 'http://127.0.0.1:3000',
  evidence: { screenshots: 'on-failure', trace: true },
  steps: [
    { id: 'open-home', action: 'goto', path: '/' },
    { id: 'page-loaded', action: 'assertText', text: 'Welcome' },
  ],
};

function help(): void {
  process.stdout.write(`
FlowCheck Local ${VERSION}

Deterministic browser checks with Playwright evidence.

Usage:
  flowcheck init [scenario.json]
  flowcheck validate <scenario.json>
  flowcheck run <scenario.json> [--headed] [--output <directory>]
  flowcheck --version

Examples:
  flowcheck init
  flowcheck run flowcheck.scenario.json --headed
  flowcheck validate examples/demo/scenario.json

No telemetry is collected. Run only against systems you are authorized to test.
`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') { help(); return; }
  if (command === '--version' || command === '-v') { process.stdout.write(`${VERSION}\n`); return; }

  if (command === 'init') {
    const destination = path.resolve(args[1] ?? 'flowcheck.scenario.json');
    await writeFile(destination, `${JSON.stringify(sample, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`Created ${destination}\n`);
    return;
  }

  const fileArg = args[1];
  if (!fileArg || fileArg.startsWith('--')) throw new Error(`${command} requires a scenario file`);
  const scenarioFile = path.resolve(fileArg);

  if (command === 'validate') {
    const parsed = JSON.parse(await readFile(scenarioFile, 'utf8')) as unknown;
    const scenario = validateScenario(parsed);
    process.stdout.write(`✓ ${scenario.name}: ${scenario.steps.length} steps are valid\n`);
    return;
  }

  if (command === 'run') {
    const scenario = await loadScenario(scenarioFile);
    process.stdout.write(`\nFlowCheck · ${scenario.name}\n`);
    process.stdout.write(`Target: ${scenario.baseUrl}\nSteps:  ${scenario.steps.length}\n\n`);
    const report = await runScenario(scenario, {
      scenarioFile,
      headed: args.includes('--headed'),
      outputDir: option(args, '--output'),
    });
    for (const step of report.steps) {
      const icon = step.status === 'passed' ? '✓' : '✗';
      process.stdout.write(`${icon} ${step.id} · ${step.action} · ${step.durationMs}ms\n`);
    }
    process.stdout.write(`\n${report.status === 'passed' ? 'PASSED' : 'FAILED'} · ${report.durationMs}ms\n`);
    process.stdout.write(`Evidence: ${report.artifacts.directory}\n`);
    if (report.error) process.stdout.write(`Error: ${report.error.message}\n`);
    if (report.status === 'failed') process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  if (error instanceof ScenarioValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`FlowCheck error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 2;
});
