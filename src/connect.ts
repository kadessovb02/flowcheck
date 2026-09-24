import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { releasePackage } from './package.ts';

export function connection(client: string, workspace: string) {
  const name = `flowcheck-${createHash('sha256').update(workspace).digest('hex').slice(0, 8)}`;
  const server = ['npx', '--yes', releasePackage, 'mcp', '--workspace', workspace];
  if (client === 'codex') return { name, command: 'codex', args: ['mcp', 'add', name, '--', ...server] };
  if (client === 'claude') return { name, command: 'claude', args: ['mcp', 'add', '--transport', 'stdio', '--scope', 'local', name, '--', ...server] };
  throw new Error('Choose a client: flowcheck connect codex or flowcheck connect claude. For other clients, use flowcheck config.');
}

export async function connect(client: string, directory: string): Promise<void> {
  const workspace = await realpath(directory);
  const config = connection(client, workspace);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.command, config.args, { cwd: workspace, stdio: 'inherit' });
    child.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT'
      ? new Error(`${config.command} is not on PATH. Run flowcheck config for a manual MCP configuration.`) : error));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${config.command} MCP registration failed (exit ${code}).`)));
  });
  process.stdout.write(`Connected ${config.name} to ${client} for ${workspace}. Restart your client session to load the tools.\n`);
}
