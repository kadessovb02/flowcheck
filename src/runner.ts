import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { publicStep, type Scenario, type ScenarioStep, type Target, validateScenario } from './schema.ts';

export interface StepReport {
  id: string;
  action: string;
  status: 'passed' | 'failed';
  startedAt: string;
  durationMs: number;
  url: string;
  screenshot?: string;
  error?: { name: string; message: string };
  input: Record<string, unknown>;
}

export interface RunReport {
  schemaVersion: 1;
  runId: string;
  scenario: { name: string; file?: string; sha256: string };
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  baseUrl: string;
  finalUrl: string;
  steps: StepReport[];
  artifacts: { directory: string; trace?: string; junit: string; report: string };
  error?: { stepId: string; name: string; message: string };
}

export interface RunOptions {
  headed?: boolean;
  outputDir?: string;
  scenarioFile?: string;
  browser?: Browser;
}

export async function loadScenario(file: string): Promise<Scenario> {
  const text = await readFile(file, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) { throw new Error(`Scenario is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return validateScenario(parsed);
}

export function scenarioDigest(scenario: Scenario): string {
  return createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
}

function locatorFor(page: Page, target: Target): Locator {
  const exact = target.exact ?? true;
  if (target.role) return page.getByRole(target.role, target.name ? { name: target.name, exact } : undefined);
  if (target.label) return page.getByLabel(target.label, { exact });
  if (target.placeholder) return page.getByPlaceholder(target.placeholder, { exact });
  if (target.testId) return page.getByTestId(target.testId);
  if (target.text) return page.getByText(target.text, { exact });
  if (target.css) return page.locator(target.css);
  throw new Error('Target has no supported selector');
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'step';
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`);
}

function errorShape(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

async function executeStep(page: Page, scenario: Scenario, step: ScenarioStep): Promise<void> {
  if (step.action === 'goto') {
    const destination = new URL(step.path, scenario.baseUrl);
    if (destination.origin !== new URL(scenario.baseUrl).origin) throw new Error(`Cross-origin navigation is blocked: ${destination.origin}`);
    await page.goto(destination.href, { waitUntil: 'domcontentloaded' });
    return;
  }
  if (step.action === 'assertText') {
    const locator = page.getByText(step.text, { exact: step.exact ?? false }).first();
    await locator.waitFor({ state: 'visible' });
    return;
  }
  if (step.action === 'assertUrl') {
    if (!wildcard(step.pattern).test(page.url())) throw new Error(`Expected URL to match "${step.pattern}", received "${page.url()}"`);
    return;
  }

  const locator = locatorFor(page, step.target);
  if (step.action === 'click') {
    await locator.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined);
  } else if (step.action === 'fill') {
    const value = step.valueFromEnv ? process.env[step.valueFromEnv] : step.value;
    if (value === undefined) throw new Error(`Environment variable ${step.valueFromEnv} is not set`);
    await locator.fill(value);
  } else if (step.action === 'select') {
    await locator.selectOption(step.value);
  } else if (step.action === 'check') {
    await locator.check();
  } else if (step.action === 'uncheck') {
    await locator.uncheck();
  } else if (step.action === 'press') {
    await locator.press(step.key);
  } else if (step.action === 'waitFor' || step.action === 'assertVisible') {
    await locator.waitFor({ state: 'visible' });
  }
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function junit(report: RunReport): string {
  const failures = report.status === 'failed' ? 1 : 0;
  const cases = report.steps.map((step) => {
    const failure = step.error ? `<failure message="${xml(step.error.message)}" type="${xml(step.error.name)}"/>` : '';
    return `  <testcase classname="${xml(report.scenario.name)}" name="${xml(step.id)}" time="${(step.durationMs / 1_000).toFixed(3)}">${failure}</testcase>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(report.scenario.name)}" tests="${report.steps.length}" failures="${failures}" time="${(report.durationMs / 1_000).toFixed(3)}">\n${cases}\n</testsuite>\n`;
}

export async function runScenario(rawScenario: Scenario, options: RunOptions = {}): Promise<RunReport> {
  const scenario = validateScenario(rawScenario);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const root = path.resolve(options.outputDir ?? '.flowcheck/runs');
  const artifactDir = path.join(root, runId);
  await mkdir(artifactDir, { recursive: true });
  const startedAt = new Date();
  const timeout = scenario.timeoutMs ?? 15_000;
  const ownBrowser = !options.browser;
  const browser = options.browser ?? await chromium.launch({ headless: !options.headed });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const steps: StepReport[] = [];
  let terminalError: RunReport['error'];
  let tracePath: string | undefined;

  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);
    if (scenario.evidence?.trace !== false) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    const allowedOrigin = new URL(scenario.baseUrl).origin;
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page?.mainFrame()) {
        const url = request.url();
        if (url !== 'about:blank' && new URL(url).origin !== allowedOrigin) {
          await route.abort('blockedbyclient');
          return;
        }
      }
      await route.continue();
    });

    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index]!;
      const stepStarted = new Date();
      let screenshot: string | undefined;
      try {
        await executeStep(page, scenario, step);
        if (new URL(page.url()).origin !== allowedOrigin) throw new Error(`Browser left the allowed origin: ${page.url()}`);
        if (scenario.evidence?.screenshots === 'always' && !(step.action === 'fill' && step.sensitive)) {
          screenshot = `${String(index + 1).padStart(3, '0')}-${safeFilePart(step.id)}.png`;
          await page.screenshot({
            path: path.join(artifactDir, screenshot), fullPage: true,
            mask: (scenario.evidence?.mask ?? []).map((target) => locatorFor(page!, target)),
          });
        }
        steps.push({
          id: step.id, action: step.action, status: 'passed', startedAt: stepStarted.toISOString(),
          durationMs: Date.now() - stepStarted.getTime(), url: page.url(), screenshot,
          input: publicStep(step),
        });
      } catch (error) {
        const shaped = errorShape(error);
        if (scenario.evidence?.screenshots !== 'off') {
          screenshot = `${String(index + 1).padStart(3, '0')}-${safeFilePart(step.id)}-failed.png`;
          await page.screenshot({
            path: path.join(artifactDir, screenshot), fullPage: true,
            mask: (scenario.evidence?.mask ?? []).map((target) => locatorFor(page!, target)),
          }).catch(() => { screenshot = undefined; });
        }
        steps.push({
          id: step.id, action: step.action, status: 'failed', startedAt: stepStarted.toISOString(),
          durationMs: Date.now() - stepStarted.getTime(), url: page.url(), screenshot,
          error: shaped, input: publicStep(step),
        });
        terminalError = { stepId: step.id, ...shaped };
        break;
      }
    }
  } finally {
    if (context && scenario.evidence?.trace !== false) {
      tracePath = 'trace.zip';
      await context.tracing.stop({ path: path.join(artifactDir, tracePath) }).catch(() => { tracePath = undefined; });
    }
    await context?.close().catch(() => undefined);
    if (ownBrowser) await browser.close().catch(() => undefined);
  }

  const finishedAt = new Date();
  const report: RunReport = {
    schemaVersion: 1,
    runId,
    scenario: { name: scenario.name, file: options.scenarioFile, sha256: scenarioDigest(scenario) },
    status: terminalError ? 'failed' : 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    baseUrl: scenario.baseUrl,
    finalUrl: page?.url() ?? scenario.baseUrl,
    steps,
    artifacts: {
      directory: artifactDir,
      trace: tracePath,
      junit: 'junit.xml',
      report: 'report.json',
    },
    error: terminalError,
  };
  await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(artifactDir, 'junit.xml'), junit(report), { mode: 0o600 });
  return report;
}
