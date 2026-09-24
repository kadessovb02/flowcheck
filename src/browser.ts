import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
let installation: Promise<void> | undefined;

export async function installBrowser(withDeps = false): Promise<void> {
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', '--no-shell', ...(withDeps ? ['--with-deps'] : []), 'chromium'], {
      // MCP reserves stdout for JSON-RPC, including during the first download.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(process.stderr);
    child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Chromium installation failed. Check your connection, then run flowcheck setup again.')));
  });
}

export async function ensureBrowser(): Promise<void> {
  try { await access(chromium.executablePath()); return; } catch {}
  if (process.env.FLOWCHECK_SKIP_BROWSER_INSTALL === '1') {
    throw new Error('Chromium is missing. Run flowcheck setup, or unset FLOWCHECK_SKIP_BROWSER_INSTALL to download it automatically.');
  }
  if (!installation) {
    process.stderr.write('FlowCheck: downloading Chromium for the first run. Later runs reuse the browser cache.\n');
    installation = installBrowser().finally(() => { installation = undefined; });
  }
  await installation;
}
