import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { publicStep, scenarioInputSchema, ScenarioValidationError, validateScenario } from '../src/schema.ts';

test('accepts an accessible deterministic scenario', () => {
  const scenario = validateScenario({
    version: 1,
    name: 'Login smoke',
    baseUrl: 'http://127.0.0.1:3000',
    steps: [
      { id: 'open', action: 'goto', path: '/' },
      { id: 'submit', action: 'click', target: { role: 'button', name: 'Sign in' } },
    ],
  });
  assert.equal(scenario.steps.length, 2);
});

test('rejects unsupported and ambiguous selectors', () => {
  assert.throws(() => validateScenario({
    version: 1,
    name: 'Unsafe selectors',
    baseUrl: 'https://example.com',
    steps: [
      { id: 'click', action: 'click', target: { css: '#submit', text: 'Submit' } },
    ],
  }), (error: unknown) => {
    assert.ok(error instanceof ScenarioValidationError);
    assert.match(error.message, /use one selector/);
    return true;
  });
});

test('requires exactly one fill value source', () => {
  assert.throws(() => validateScenario({
    version: 1,
    name: 'Bad secret',
    baseUrl: 'https://example.com',
    steps: [
      { id: 'password', action: 'fill', target: { label: 'Password' }, value: 'plain', valueFromEnv: 'PASSWORD' },
    ],
  }), /exactly one of value or valueFromEnv/);
});

test('redacts sensitive literal values from reports', () => {
  assert.deepEqual(publicStep({
    id: 'password', action: 'fill', target: { label: 'Password' }, value: 'secret', sensitive: true,
  }), {
    id: 'password', action: 'fill', target: { label: 'Password' }, value: '[redacted]', valueFromEnv: undefined, sensitive: true,
  });
});

test('rejects fields and optional values that the published schema excludes', () => {
  const base = { version: 1, name: 'Contract', baseUrl: 'http://localhost:3000', steps: [{ id: 'open', action: 'goto', path: '/' }] };
  for (const value of [
    { ...base, extra: 1 },
    { ...base, steps: [{ id: 'text', action: 'assertText', text: 'Ready', exact: 'yes' }] },
    { ...base, steps: [{ id: 'fill', action: 'fill', target: { css: '#x' }, value: 'x', valueFromEnv: 42 }] },
    { ...base, steps: [{ id: 'x', action: 'click', target: { css: '#x', extra: true } }] },
    { ...base, steps: [{ id: 'x', action: 'goto', path: '/' }, { id: 'x', action: 'goto', path: '/' }] },
    { ...base, baseUrl: 'ftp://localhost' },
  ]) assert.throws(() => validateScenario(value), ScenarioValidationError);
  const assertTextSchema = (scenarioInputSchema.properties.steps.items.oneOf as object[]).find((item) =>
    (item as { properties?: { action?: { const?: string } } }).properties?.action?.const === 'assertText') as { properties: { target?: unknown } };
  assert.ok(assertTextSchema.properties.target);
});

test('published JSON Schema agrees with runtime validation on structural scenarios', () => {
  const accepts = new Ajv2020({ strict: false }).compile(scenarioInputSchema);
  const base = { version: 1, name: 'Parity', baseUrl: 'http://localhost:3000', steps: [
    { id: 'open', action: 'goto', path: '/' },
    { id: 'text', action: 'assertText', text: 'Ready', exact: true, target: { testId: 'status' } },
  ] };
  const samples = [
    base,
    { ...base, unexpected: true },
    { ...base, steps: [{ id: 'x', action: 'assertText', text: 'Ready', exact: 'yes' }] },
    { ...base, steps: [{ id: 'x', action: 'fill', target: { css: '#x' }, value: 'a', valueFromEnv: 'TOKEN' }] },
    { ...base, steps: [{ id: 'x', action: 'fill', target: { css: '#x' }, value: 'a', valueFromEnv: 7 }] },
    { ...base, steps: [{ id: 'x', action: 'click', target: { css: '#x', text: 'X' } }] },
    { ...base, steps: [{ id: 'x', action: 'click', target: { name: 'X', css: '#x' } }] },
    { ...base, timeoutMs: 100 },
  ];
  for (const sample of samples) {
    let runtime = true;
    try { validateScenario(sample); } catch { runtime = false; }
    assert.equal(Boolean(accepts(sample)), runtime, JSON.stringify(sample));
  }
});
