import assert from 'node:assert/strict';
import test from 'node:test';
import { connection } from '../src/connect.ts';

test('client registration preserves paths with spaces as one argument and isolates project names', () => {
  const workspace = '/tmp/project with spaces';
  for (const client of ['codex', 'claude']) {
    const result = connection(client, workspace);
    assert.equal(result.command, client);
    assert.equal(result.args.at(-1), workspace);
    assert.ok(result.args.includes('--'));
    assert.notEqual(result.name, connection(client, '/tmp/another-project').name);
  }
  assert.ok(connection('claude', workspace).args.includes('local'));
  assert.throws(() => connection('unknown', workspace), /Choose a client/);
});
