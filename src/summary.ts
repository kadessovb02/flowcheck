import { version } from './package.ts';
import path from 'node:path';
import type { RunReport } from './runner.ts';
import type { SuiteReport } from './suite.ts';

function safe(value: unknown): string {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/([\\`*_{}\[\]()#+.!|<>~-])/g, '\\$1').slice(0, 500);
}

function artifactPath(value: string): string {
  return path.relative(process.cwd(), value).replace(/[\x00-\x1f\x7f`]/g, '').slice(0, 500);
}

export function markdownErrorSummary(message: string): string {
  return `## FlowCheck\n\nRun could not complete: ${safe(message)}\n`;
}

export function markdownSummary(result: RunReport | SuiteReport): string {
  const reports = 'cases' in result ? result.cases.map((entry) => entry.report).filter((item): item is RunReport => Boolean(item)) : [result];
  const counts = 'cases' in result ? result.counts : {
    scenarios: 1, passed: result.status === 'passed' ? 1 : 0, failed: result.status === 'failed' ? 1 : 0,
    errored: result.status === 'errored' ? 1 : 0, skipped: 0,
  };
  const lines = ['## FlowCheck', '', `Version: ${safe(version)} · App commit: ${safe(process.env.GITHUB_SHA ?? 'unknown')}`,
    '', `Scenarios: ${counts.scenarios} · passed: ${counts.passed} · failed: ${counts.failed} · errored: ${counts.errored} · skipped: ${counts.skipped}`, ''];
  for (const report of reports) {
    lines.push(`### ${safe(report.scenario.name)} (${safe(report.status)})`,
      `Scenario version: ${report.scenario.version} · SHA-256: ${safe(report.scenario.sha256)}`, '');
    for (const step of report.steps.filter((item) => item.status === 'failed' || item.status === 'errored')) {
      lines.push(`- ${safe(step.id)}: ${safe(step.error?.message)}`);
      if (step.error?.expected !== undefined) lines.push(`  - Expected: ${safe(step.error.expected)}`);
      if (step.error?.actual !== undefined) lines.push(`  - Actual: ${safe(step.error.actual)}`);
    }
    lines.push(`Evidence path in uploaded artifact: \`${artifactPath(report.artifacts.directory)}\``, '');
  }
  if ('cases' in result) {
    for (const entry of result.cases.filter((item) => !item.report && item.status !== 'skipped')) lines.push(`- ${safe(entry.file)}: ${safe(entry.error)}`);
  }
  lines.push(`JSON and JUnit: \`${artifactPath(result.artifacts.directory)}\` (upload this directory as a workflow artifact).`, '');
  return lines.join('\n');
}
