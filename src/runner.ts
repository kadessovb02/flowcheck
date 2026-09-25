import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { ensureBrowser } from './browser.ts';
import { publicStep, type Scenario, type ScenarioStep, type Target, validateScenario } from './schema.ts';

export interface StepReport {
  id: string;
  action: string;
  status: 'passed' | 'failed' | 'errored' | 'skipped';
  startedAt: string;
  durationMs: number;
  url: string;
  screenshot?: string;
  error?: { name: string; message: string; expected?: string; actual?: string };
  input: Record<string, unknown>;
}

export interface RunReport {
  schemaVersion: 2;
  runId: string;
  scenario: { name: string; version: number; file?: string; sha256: string; sourceSha256?: string };
  status: 'passed' | 'failed' | 'errored';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  baseUrl: string;
  finalUrl: string;
  steps: StepReport[];
  artifacts: { directory: string; trace?: string; junit: string; report: string };
  error?: { stepId?: string; name: string; message: string; expected?: string; actual?: string };
}

export interface RunOptions {
  headed?: boolean;
  outputDir?: string;
  scenarioFile?: string;
  browser?: Browser;
  baseUrl?: string;
}

class AssertionFailure extends Error {
  readonly expected: string;
  readonly actual: string;
  constructor(message: string, expected: string, actual: string) {
    super(message);
    this.name = 'AssertionFailure';
    this.expected = expected;
    this.actual = actual;
  }
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

function errorShape(error: unknown): { name: string; message: string; expected?: string; actual?: string } {
  if (error instanceof AssertionFailure) return { name: error.name, message: error.message, expected: error.expected, actual: error.actual };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

async function executeStep(page: Page, scenario: Scenario, step: ScenarioStep): Promise<void> {
  if (step.action === 'goto') {
    const destination = new URL(step.path, scenario.baseUrl);
    if (destination.origin !== new URL(scenario.baseUrl).origin) throw new Error(`Cross-origin navigation is blocked: ${destination.origin}`);
    const response = await page.goto(destination.href, { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) throw new Error(`Navigation failed with HTTP ${response.status()}: ${destination.href}`);
    return;
  }
  if (step.action === 'assertText') {
    const scope = step.target ? locatorFor(page, step.target).filter({ visible: true }) : page.locator('body');
    const locator = scope.getByText(step.text, { exact: step.exact ?? false }).filter({ visible: true });
    await locator.waitFor({ state: 'visible' });
    return;
  }
  if (step.action === 'assertUrl') {
    const pattern = step.pattern.startsWith('/') ? `${new URL(scenario.baseUrl).origin}${step.pattern}` : step.pattern;
    try {
      await page.waitForURL((url) => wildcard(pattern).test(url.href), { timeout: scenario.timeoutMs ?? 15_000 });
    } catch {
      throw new AssertionFailure(`Expected URL to match "${pattern}", received "${page.url()}"`, pattern, page.url());
    }
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
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function junit(report: RunReport): string {
  const failures = report.steps.filter((step) => step.status === 'failed').length;
  const errors = report.steps.filter((step) => step.status === 'errored').length + (report.status === 'errored' && !report.error?.stepId ? 1 : 0);
  const skipped = report.steps.filter((step) => step.status === 'skipped').length;
  const cases = report.steps.map((step) => {
    const tag = step.status === 'failed' ? 'failure' : step.status === 'errored' ? 'error' : undefined;
    const child = tag && step.error ? `<${tag} message="${xml(step.error.message)}" type="${xml(step.error.name)}"/>` : step.status === 'skipped' ? '<skipped/>' : '';
    return `  <testcase classname="${xml(report.scenario.name)}" name="${xml(step.id)}" time="${(step.durationMs / 1_000).toFixed(3)}">${child}</testcase>`;
  }).join('\n');
  const setup = report.status === 'errored' && !report.error?.stepId ? `  <testcase classname="${xml(report.scenario.name)}" name="setup"><error message="${xml(report.error?.message ?? 'Infrastructure error')}"/></testcase>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(report.scenario.name)}" tests="${report.steps.length + (setup ? 1 : 0)}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${(report.durationMs / 1_000).toFixed(3)}">\n${setup}${cases}\n</testsuite>\n`;
}

export async function runScenario(rawScenario: Scenario, options: RunOptions = {}): Promise<RunReport> {
  const sourceScenario = validateScenario(rawScenario);
  const scenario = options.baseUrl === undefined ? sourceScenario : validateScenario({ ...sourceScenario, baseUrl: options.baseUrl });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const root = path.resolve(options.outputDir ?? '.flowcheck/runs');
  const artifactDir = path.join(root, runId);
  await mkdir(artifactDir, { recursive: true });
  const startedAt = new Date();
  const timeout = scenario.timeoutMs ?? 15_000;
  const ownBrowser = !options.browser;
  let browser: Browser | undefined = options.browser;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const steps: StepReport[] = [];
  let terminalError: RunReport['error'];
  let status: RunReport['status'] = 'passed';
  let tracePath: string | undefined;
  let evidenceError: Error | undefined;

  try {
    if (!browser) {
      await ensureBrowser();
      browser = await chromium.launch({ headless: !options.headed, channel: 'chromium' });
    }
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
          try {
            await page.screenshot({
              path: path.join(artifactDir, screenshot), fullPage: true,
              mask: (scenario.evidence?.mask ?? []).map((target) => locatorFor(page!, target)),
            });
          } catch (error) {
            evidenceError = error instanceof Error ? error : new Error(String(error));
            throw evidenceError;
          }
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
        const stepStatus = evidenceError || page.isClosed() || !browser.isConnected() ? 'errored' : 'failed';
        steps.push({
          id: step.id, action: step.action, status: stepStatus, startedAt: stepStarted.toISOString(),
          durationMs: Date.now() - stepStarted.getTime(), url: page.url(), screenshot,
          error: shaped, input: publicStep(step),
        });
        terminalError = { stepId: step.id, ...shaped };
        status = stepStatus;
        break;
      }
    }
  } catch (error) {
    terminalError = errorShape(error);
    status = 'errored';
  } finally {
    if (context && scenario.evidence?.trace !== false) {
      tracePath = 'trace.zip';
      try { await context.tracing.stop({ path: path.join(artifactDir, tracePath) }); }
      catch (error) {
        tracePath = undefined;
        status = 'errored';
        terminalError = errorShape(error);
      }
    }
    await context?.close().catch(() => undefined);
    if (ownBrowser) await browser?.close().catch(() => undefined);
  }

  for (const step of scenario.steps.slice(steps.length)) {
    steps.push({ id: step.id, action: step.action, status: 'skipped', startedAt: new Date().toISOString(),
      durationMs: 0, url: page?.url() ?? scenario.baseUrl, input: publicStep(step) });
  }

  const finishedAt = new Date();
  const report: RunReport = {
    schemaVersion: 2,
    runId,
    scenario: { name: scenario.name, version: scenario.version, file: options.scenarioFile, sha256: scenarioDigest(scenario),
      ...(options.baseUrl === undefined ? {} : { sourceSha256: scenarioDigest(sourceScenario) }) },
    status,
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
  try {
    await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await writeFile(path.join(artifactDir, 'junit.xml'), junit(report), { mode: 0o600 });
  } catch (error) {
    throw new Error(`Could not write FlowCheck report in ${artifactDir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
