import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadScenario, runScenario, type RunReport } from './runner.ts';
import { packageRoot } from './package.ts';

export async function runDemo(options: { headed?: boolean; broken?: boolean; outputDir?: string }): Promise<RunReport> {
  const demo = spawn(process.execPath, [path.join(packageRoot, 'examples/demo/server.mjs')], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env: { ...process.env, PORT: '0', FLOWCHECK_DEMO_BROKEN: options.broken ? '1' : '0' },
  });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Demo server did not start within 5 seconds')), 5_000);
      const onExit = () => finish(new Error('Demo server exited before startup'));
      const onError = (error: Error) => finish(error);
      const onMessage = (message: unknown) => {
        if (message && typeof message === 'object' && 'origin' in message && typeof message.origin === 'string') finish(undefined, message.origin);
      };
      function finish(error?: Error, origin?: string) {
        clearTimeout(timer);
        demo.off('exit', onExit);
        demo.off('error', onError);
        demo.off('message', onMessage);
        if (error) reject(error);
        else resolve(origin!);
      }
      demo.once('error', onError);
      demo.once('exit', onExit);
      demo.on('message', onMessage);
    });
    process.stderr.write(`Demo: ${origin}\n`);
    if (options.broken) process.stderr.write('Broken demo: workspace creation will fail. Expect FAILED and exit code 1.\n');
    const scenario = await loadScenario(path.join(packageRoot, 'examples/demo/scenario.json'));
    scenario.baseUrl = origin;
    // Only the ephemeral port changes; both modes execute the same assertions.
    scenario.steps = scenario.steps.map((step) => step.action === 'assertUrl' ? { ...step, pattern: `${origin}/welcome` } : step);
    return await runScenario(scenario, options);
  } finally {
    demo.kill('SIGTERM');
  }
}
