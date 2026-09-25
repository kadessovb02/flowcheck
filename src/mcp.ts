#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { realpath } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pageScenario } from './check.ts';
import { version } from './package.ts';
import { scenarioInputSchema, validateScenario } from './schema.ts';
import { loadScenario, runScenario, type RunReport } from './runner.ts';

const workspaceRoot = await realpath(path.resolve(process.env.FLOWCHECK_WORKSPACE_ROOT ?? process.cwd()));
let latestReport: RunReport | undefined;

const server = new Server(
  { name: 'flowcheck-local', version },
  { capabilities: { tools: {} }, instructions: 'Use flowcheck_check_page for a page smoke check. For a user journey, construct an inline scenario using the tool schema, validate it, and run it after user approval. Prefer accessible locators and valueFromEnv for secrets. Report only checks actually executed; a page check does not prove an entire application works. Chromium is downloaded on the first run if missing. Evidence stays in the configured workspace.' },
);

const tools = [
  {
    name: 'flowcheck_validate_scenario',
    description: 'Validate an inline scenario or a workspace scenario file without opening a browser.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object', additionalProperties: false, oneOf: [{ required: ['scenarioPath'] }, { required: ['scenario'] }],
      properties: { scenarioPath: { type: 'string', description: 'Path relative to the configured workspace root.' }, scenario: scenarioInputSchema },
    },
  },
  {
    name: 'flowcheck_run_scenario',
    description: 'Run an approved inline scenario or workspace scenario file in Chromium. Returns actual pass/fail results and evidence paths. May download Chromium on the first run.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false, oneOf: [{ required: ['scenarioPath'] }, { required: ['scenario'] }],
      properties: {
        scenario: scenarioInputSchema,
        scenarioPath: { type: 'string', description: 'Path relative to the configured workspace root.' },
        headed: { type: 'boolean', description: 'Show the Chromium window. Defaults to false.' },
      },
    },
  },
  {
    name: 'flowcheck_check_page',
    description: 'Open a URL, reject HTTP error responses, verify a visible page and optionally expected text. No scenario file needed. This is a smoke check, not full user-journey coverage.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute HTTP(S) URL of the page to check.' },
        text: { type: 'string', description: 'Optional visible text expected on the page.' },
        headed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'flowcheck_latest_report',
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: 'Read the concise result of the latest scenario run in this MCP session.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
] as const;

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError };
}

async function safeScenarioPath(input: unknown): Promise<string> {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1_000) throw new Error('scenarioPath must be a non-empty string');
  const resolved = await realpath(path.resolve(workspaceRoot, input));
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Scenario must be inside FLOWCHECK_WORKSPACE_ROOT');
  return resolved;
}

async function scenarioFrom(args: Record<string, unknown>) {
  if ((args.scenarioPath !== undefined) === (args.scenario !== undefined)) {
    throw new Error('Provide exactly one of scenarioPath or scenario.');
  }
  if (args.scenario !== undefined) return { scenario: validateScenario(args.scenario) };
  const scenarioFile = await safeScenarioPath(args.scenarioPath);
  return { scenario: await loadScenario(scenarioFile), scenarioFile };
}

function summary(report: RunReport) {
  return {
    status: report.status,
    scenario: report.scenario.name,
    durationMs: report.durationMs,
    steps: report.steps.map(({ id, action, status, screenshot }) => ({ id, action, status, screenshot })),
    passedSteps: report.steps.filter((step) => step.status === 'passed').length,
    failedStep: report.error?.stepId,
    error: report.error?.message,
    evidenceDirectory: report.artifacts.directory,
    report: path.join(report.artifacts.directory, report.artifacts.report),
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments ?? {};
    if (request.params.name === 'flowcheck_validate_scenario') {
      const { scenario } = await scenarioFrom(args);
      return text({ valid: true, name: scenario.name, steps: scenario.steps.length, baseUrl: scenario.baseUrl });
    }
    if (request.params.name === 'flowcheck_run_scenario') {
      const { scenario, scenarioFile } = await scenarioFrom(args);
      latestReport = await runScenario(scenario, {
        scenarioFile,
        headed: args.headed === true,
        outputDir: path.join(workspaceRoot, '.flowcheck', 'runs'),
      });
      return text(summary(latestReport), latestReport.status !== 'passed');
    }
    if (request.params.name === 'flowcheck_check_page') {
      if (typeof args.url !== 'string' || (args.text !== undefined && typeof args.text !== 'string')) throw new Error('url and optional text must be strings');
      latestReport = await runScenario(pageScenario(args.url, args.text as string | undefined), {
        headed: args.headed === true, outputDir: path.join(workspaceRoot, '.flowcheck', 'runs'),
      });
      return text(summary(latestReport), latestReport.status !== 'passed');
    }
    if (request.params.name === 'flowcheck_latest_report') {
      return latestReport ? text(summary(latestReport)) : text('No scenario has been run in this MCP session.', true);
    }
    return text(`Unknown tool: ${request.params.name}`, true);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
});

await server.connect(new StdioServerTransport());
