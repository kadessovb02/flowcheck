import assert from 'node:assert/strict';
import test from 'node:test';
import { publicStep, ScenarioValidationError, validateScenario } from '../src/schema.ts';

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
