import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownSummary } from '../src/summary.ts';
import type { RunReport } from '../src/runner.ts';

test('job summary escapes scenario and error markup and removes control sequences', () => {
  const report: RunReport = {
    schemaVersion: 2, runId: 'test', scenario: { name: '<script>bad</script>', version: 1, sha256: 'abc' },
    status: 'failed', startedAt: '', finishedAt: '', durationMs: 1, baseUrl: 'http://localhost', finalUrl: 'http://localhost',
    artifacts: { directory: '/tmp/results', report: 'report.json', junit: 'junit.xml' },
    steps: [{ id: 'text', action: 'assertText', status: 'failed', startedAt: '', durationMs: 1, url: '', input: {},
      error: { name: 'AssertionFailure', message: '\u001b[31m<script>hello</script>', expected: '**safe**', actual: '<img>' } }],
  };
  const summary = markdownSummary(report);
  assert.doesNotMatch(summary, /<script>|<img>|\u001b/);
  assert.match(summary, /Expected: \\\*\\\*safe\\\*\\\*/);
});
