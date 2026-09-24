import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  process.stdout.write(`Usage: npm run quickstart -- [--headed] [--broken]

  --headed  Show the Chromium window.
  --broken  Run the unchanged scenario against a broken demo (expected exit code 1).
  --help    Show this help without starting the demo.

The demo uses localhost port 4173 and saves evidence to .flowcheck/runs/.
`);
  process.exit(0);
}
const unknown = args.find((arg) => !['--headed', '--broken'].includes(arg));
if (unknown) {
  process.stderr.write(`Unknown option: ${unknown}. Usage: npm run quickstart -- [--headed] [--broken]\n`);
  process.exit(2);
}
if (args.includes('--broken')) {
  process.stdout.write('Broken demo: workspace creation will fail. Expect FAILED and exit code 1.\n');
}

const demo = spawn(process.execPath, ['examples/demo/server.mjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, PORT: '4173', FLOWCHECK_DEMO_BROKEN: args.includes('--broken') ? '1' : '0' },
});
demo.stdout.pipe(process.stdout);

try {
  // Wait for this child to listen, rather than trusting another server's /health.
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Demo server did not start within 5 seconds')), 5_000);
    const onExit = () => finish(new Error('Demo server exited before startup. Check whether port 4173 is in use.'));
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('Demo: http://127.0.0.1:4173\n')) finish();
    };
    function finish(error) {
      clearTimeout(timer);
      demo.off('exit', onExit);
      demo.off('error', onError);
      demo.stdout.off('data', onData);
      if (error) reject(error);
      else resolve();
    }
    demo.once('exit', onExit);
    demo.once('error', onError);
    demo.stdout.on('data', onData);
  });
  const runnerArgs = ['--experimental-strip-types', 'src/cli.ts', 'run', 'examples/demo/scenario.json'];
  if (args.includes('--headed')) runnerArgs.push('--headed');
  const runner = spawn(process.execPath, runnerArgs, { stdio: 'inherit' });
  const exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', resolve);
  });
  process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
} catch (error) {
  process.stderr.write(`Quickstart error: ${error.message}\n`);
  process.exitCode = 2;
} finally {
  demo.kill('SIGTERM');
}
