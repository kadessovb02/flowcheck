import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP server lists tools and validates a workspace scenario over stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', 'src/mcp.ts'],
    cwd: process.cwd(),
    env: { ...getDefaultEnvironment(), FLOWCHECK_WORKSPACE_ROOT: process.cwd() },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'flowcheck-test', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      'flowcheck_validate_scenario',
      'flowcheck_run_scenario',
      'flowcheck_latest_report',
    ]);
    const result = await client.callTool({
      name: 'flowcheck_validate_scenario',
      arguments: { scenarioPath: 'examples/demo/scenario.json' },
    });
    assert.equal(result.isError, false);
    const first = result.content[0];
    assert.ok(first && first.type === 'text');
    assert.match(first.text, /Create a demo workspace/);
  } finally {
    await client.close();
  }
});
