#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { realpath } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadScenario, runScenario, type RunReport } from './runner.ts';

const workspaceRoot = path.resolve(process.env.FLOWCHECK_WORKSPACE_ROOT ?? process.cwd());
let latestReport: RunReport | undefined;

const server = new Server(
  { name: 'flowcheck-local', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const tools = [
  {
    name: 'flowcheck_validate_scenario',
    description: 'Validate a FlowCheck Scenario DSL file without opening a browser.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['scenarioPath'],
      properties: { scenarioPath: { type: 'string', description: 'Path relative to the configured workspace root.' } },
    },
  },
  {
    name: 'flowcheck_run_scenario',
    description: 'Run an approved local browser scenario and return a concise result plus evidence path. This opens Chromium and interacts with the configured target.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['scenarioPath'],
      properties: {
        scenarioPath: { type: 'string', description: 'Path relative to the configured workspace root.' },
        headed: { type: 'boolean', description: 'Show the Chromium window. Defaults to false.' },
      },
    },
  },
  {
    name: 'flowcheck_latest_report',
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
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Scenario must be inside FLOWCHECK_WORKSPACE_ROOT');
  return resolved;
}

function summary(report: RunReport) {
  return {
    status: report.status,
    scenario: report.scenario.name,
    durationMs: report.durationMs,
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
      const scenarioPath = await safeScenarioPath(args.scenarioPath);
      const scenario = await loadScenario(scenarioPath);
      return text({ valid: true, name: scenario.name, steps: scenario.steps.length, baseUrl: scenario.baseUrl });
    }
    if (request.params.name === 'flowcheck_run_scenario') {
      const scenarioPath = await safeScenarioPath(args.scenarioPath);
      const scenario = await loadScenario(scenarioPath);
      latestReport = await runScenario(scenario, {
        scenarioFile: scenarioPath,
        headed: args.headed === true,
        outputDir: path.join(workspaceRoot, '.flowcheck', 'runs'),
      });
      return text(summary(latestReport), latestReport.status === 'failed');
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
