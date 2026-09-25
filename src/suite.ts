import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScenario, runScenario, junit, type RunOptions, type RunReport } from './runner.ts';
import { ScenarioValidationError } from './schema.ts';

export interface SuiteCase {
  file: string;
  status: 'passed' | 'failed' | 'errored' | 'skipped';
  report?: RunReport;
  error?: string;
}

export interface SuiteReport {
  schemaVersion: 1;
  kind: 'suite';
  status: 'passed' | 'failed' | 'errored';
  counts: { scenarios: number; passed: number; failed: number; errored: number; skipped: number };
  cases: SuiteCase[];
  artifacts: { directory: string; report: string; junit: string };
}

function globRegex(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      i += 1;
      if (pattern[i + 1] === '/') { i += 1; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesUnder(full));
    else if (item.isFile() && item.name.endsWith('.json')) files.push(full);
  }
  return files;
}

export async function resolveScenarioFiles(input: string): Promise<string[]> {
  const absolute = path.resolve(input);
  if (!/[*?]/.test(input)) {
    const info = await stat(absolute);
    return (info.isDirectory() ? await filesUnder(absolute) : [absolute]).sort();
  }
  const first = absolute.search(/[*?]/);
  const slash = absolute.lastIndexOf(path.sep, first);
  const root = absolute.slice(0, slash) || path.sep;
  const matcher = globRegex(absolute.split(path.sep).join('/'));
  return (await filesUnder(root)).filter((file) => matcher.test(file.split(path.sep).join('/'))).sort();
}

function xml(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function suiteJunit(cases: SuiteCase[]): string {
  const bodies = cases.map((entry) => {
    if (entry.report) return junit(entry.report).replace(/^<\?xml[^\n]*\n/, '');
    const child = entry.status === 'skipped' ? '<skipped/>' : `<error message="${xml(entry.error ?? 'Invalid scenario')}"/>`;
    return `<testsuite name="${xml(entry.file)}" tests="1" failures="0" errors="${entry.status === 'errored' ? 1 : 0}" skipped="${entry.status === 'skipped' ? 1 : 0}"><testcase name="load">${child}</testcase></testsuite>\n`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${bodies}</testsuites>\n`;
}

export async function runSuite(input: string, options: RunOptions = {}): Promise<SuiteReport> {
  const files = await resolveScenarioFiles(input);
  if (!files.length) throw new Error(`No scenario JSON files matched ${input}`);
  const directory = path.join(path.resolve(options.outputDir ?? '.flowcheck/runs'), `suite-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true });
  const cases: SuiteCase[] = [];
  let infrastructureFailed = false;
  for (const file of files) {
    if (infrastructureFailed) { cases.push({ file, status: 'skipped' }); continue; }
    let scenario;
    try {
      scenario = await loadScenario(file);
    } catch (error) {
      cases.push({ file, status: 'errored', error: error instanceof Error ? error.message : String(error) });
      if (!(error instanceof ScenarioValidationError) && !(error instanceof Error && error.message.startsWith('Scenario is not valid JSON:'))) infrastructureFailed = true;
      continue;
    }
    try {
      const report = await runScenario(scenario, { ...options, outputDir: directory, scenarioFile: file });
      cases.push({ file, status: report.status, report });
      if (report.status === 'errored') infrastructureFailed = true;
    } catch (error) {
      cases.push({ file, status: 'errored', error: error instanceof Error ? error.message : String(error) });
      infrastructureFailed = true;
    }
  }
  const counts = { scenarios: cases.length, passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const entry of cases) counts[entry.status] += 1;
  const report: SuiteReport = { schemaVersion: 1, kind: 'suite', status: counts.errored ? 'errored' : counts.failed ? 'failed' : 'passed',
    counts, cases, artifacts: { directory, report: 'suite.json', junit: 'junit.xml' } };
  try {
    await writeFile(path.join(directory, 'suite.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await writeFile(path.join(directory, 'junit.xml'), suiteJunit(cases), { mode: 0o600 });
  } catch (error) {
    throw new Error(`Could not write FlowCheck suite report in ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
