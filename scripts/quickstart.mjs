import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'demo', ...process.argv.slice(2)], { stdio: 'inherit' });
child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
