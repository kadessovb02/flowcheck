import { spawn } from 'node:child_process';
import process from 'node:process';

const demo = spawn(process.execPath, ['examples/demo/server.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
demo.stdout.pipe(process.stdout);

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:4173/health', { signal: AbortSignal.timeout(250) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Demo server did not start');
  const runner = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts', 'run', 'examples/demo/scenario.json'], { stdio: 'inherit' });
  const exitCode = await new Promise((resolve) => runner.once('exit', resolve));
  process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
} finally {
  demo.kill('SIGTERM');
}
