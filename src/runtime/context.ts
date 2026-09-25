import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CodeContext, CodeContextProvider, Skill } from './domain.ts';
import { estimateTokens } from './domain.ts';

const exec = promisify(execFile);
const words = (value: string) => [...new Set((value.toLowerCase().match(/[a-zа-я0-9_]{3,}/gi) ?? []).filter((x) => !['with', 'from', 'this', 'that', 'the', 'and', 'для', 'это'].includes(x)))];

function graphValues(value: unknown, keys: string[]): string[] {
  const collected: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 5 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.slice(0, 30).forEach((item) => walk(item, depth + 1)); return; }
    for (const [key, item] of Object.entries(node)) {
      if (keys.includes(key) && Array.isArray(item)) {
        for (const entry of item.slice(0, 30)) {
          if (typeof entry === 'string') collected.push(entry);
          else if (entry && typeof entry === 'object') {
            const object = entry as Record<string, unknown>;
            const label = object.name ?? object.path ?? object.id ?? object.file_path;
            if (typeof label === 'string') collected.push(label);
          }
        }
      }
      walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return [...new Set(collected)].slice(0, 30);
}

export class LexicalCodeContextProvider implements CodeContextProvider {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  async getContext(task: string, changedFiles: string[] = [], tokenBudget = 4000): Promise<CodeContext> {
    const { stdout } = await exec('git', ['ls-files'], { cwd: this.root });
    const files = stdout.split('\n').filter((file) => /\.(ts|tsx|js|mjs|py|go|rs|md)$/.test(file));
    const terms = words(task);
    const ranked = await Promise.all(files.map(async (file) => {
      const body = await readFile(path.join(this.root, file), 'utf8').catch(() => '');
      const text = `${file}\n${body}`.toLowerCase();
      const score = (changedFiles.includes(file) ? 100 : 0) + (/\.(ts|tsx|js|mjs|py|go|rs)$/.test(file) ? 3 : 0) +
        terms.reduce((total, term) => total + (text.includes(term) ? (file.toLowerCase().includes(term) ? 8 : 1) : 0), 0);
      return { file, body, score };
    }));
    ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    const selected = ranked.filter((item) => item.score > 3).slice(0, 5);
    const snippets: CodeContext['snippets'] = [];
    let remaining = tokenBudget;
    for (const { file, body } of selected) {
      const lines = body.split('\n');
      const hits = lines.flatMap((line, index) => terms.some((term) => line.toLowerCase().includes(term)) ? [index] : []);
      const keep = new Set<number>();
      for (const hit of hits.slice(0, 8)) for (let i = Math.max(0, hit - 2); i <= Math.min(lines.length - 1, hit + 4); i++) keep.add(i);
      if (!keep.size) lines.slice(0, 12).forEach((_, i) => keep.add(i));
      const excerpt = [...keep].sort((a, b) => a - b).map((i) => `${i + 1}: ${lines[i]}`).join('\n');
      const limited = excerpt.slice(0, Math.max(0, remaining * 4));
      if (!limited) break;
      const tokens = estimateTokens(limited);
      snippets.push({ path: file, text: limited, tokens });
      remaining -= tokens;
    }
    return { relevantFiles: snippets.map((x) => x.path), relevantSymbols: [], dependencies: [], callers: [], callees: [],
      tests: selected.filter((x) => /test|spec/.test(x.file)).map((x) => x.file), affectedFlows: [], riskFeatures: [],
      architectureContext: 'Lexical fallback; graph relations unavailable.', estimatedTokens: tokenBudget - remaining, snippets, source: 'lexical' };
  }
}

// The external graph runs as an isolated MCP process. Its response is treated as data, not instructions.
export class GraphCodeContextProvider implements CodeContextProvider {
  private readonly root: string;
  private readonly fallback: CodeContextProvider;
  constructor(root: string, fallback: CodeContextProvider) { this.root = root; this.fallback = fallback; }
  async getContext(task: string, changedFiles: string[] = [], tokenBudget = 4000): Promise<CodeContext> {
    const client = new Client({ name: 'flowcheck-runtime', version: '0.1.0' });
    try {
      const command = process.env.CODE_REVIEW_GRAPH_COMMAND ?? 'code-review-graph';
      const prefix = process.env.CODE_REVIEW_GRAPH_PREFIX_ARGS ? JSON.parse(process.env.CODE_REVIEW_GRAPH_PREFIX_ARGS) as unknown : [];
      if (!Array.isArray(prefix) || !prefix.every((item) => typeof item === 'string')) throw new Error('CODE_REVIEW_GRAPH_PREFIX_ARGS must be a JSON string array');
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      await client.connect(new StdioClientTransport({ command, args: [...prefix, 'serve', '--repo', this.root], env }));
      const available = (await client.listTools()).tools;
      if (!available.some((tool) => tool.name === 'get_minimal_context_tool')) throw new Error('Graph tool unavailable');
      const tool = available.find((item) => item.name === 'get_minimal_context_tool')!;
      const properties = tool.inputSchema.properties ?? {};
      const args: Record<string, unknown> = {};
      if ('query' in properties) args.query = task;
      if ('task' in properties) args.task = task;
      if ('token_budget' in properties) args.token_budget = tokenBudget;
      if ('changed_files' in properties) args.changed_files = changedFiles;
      const names = [tool.name, 'semantic_search_nodes_tool', ...(changedFiles.length ? ['get_impact_radius_tool', 'get_affected_flows_tool'] : [])];
      const sections: string[] = [];
      const payloads: unknown[] = [];
      let graphReady = true;
      for (const name of names) {
        const candidate = available.find((item) => item.name === name);
        if (!candidate) continue;
        const fields = candidate.inputSchema.properties ?? {};
        const arguments_: Record<string, unknown> = name === tool.name ? args : {};
        if ('query' in fields) arguments_.query = task;
        if ('file_paths' in fields) arguments_.file_paths = changedFiles;
        if ('changed_files' in fields) arguments_.changed_files = changedFiles;
        if ('token_budget' in fields) arguments_.token_budget = Math.min(tokenBudget, 1200);
        if ('limit' in fields) arguments_.limit = 5;
        try {
          const response = await client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 15_000 });
          if (response.isError) continue;
          const content = response.content as { type: string; text?: string }[];
          const raw = content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
          if (raw) {
            let parsed: unknown;
            try { parsed = JSON.parse(raw); } catch { /* graph may return prose */ }
            if (name === tool.name && parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).status === 'not_ready') {
              graphReady = false;
              break;
            }
            sections.push(`${name}: ${raw}`);
            if (parsed) payloads.push(parsed);
          }
        } catch { /* a missing or incompatible graph query is optional */ }
      }
      const baseline = await this.fallback.getContext(task, changedFiles, tokenBudget);
      if (!graphReady) return baseline;
      const fallback = await this.fallback.getContext(task, changedFiles, Math.min(500, Math.floor(tokenBudget / 4)));
      const graphText = sections.join('\n').slice(0, Math.min(800, Math.max(0, tokenBudget - fallback.estimatedTokens)) * 4);
      if (!graphText) return baseline;
      const estimatedTokens = fallback.estimatedTokens + estimateTokens(graphText);
      if (estimatedTokens >= baseline.estimatedTokens) return baseline;
      return { ...fallback, relevantSymbols: graphValues(payloads, ['symbols', 'relevant_symbols', 'nodes', 'results', 'changed_nodes', 'impacted_nodes']),
        dependencies: graphValues(payloads, ['dependencies', 'imports']), callers: graphValues(payloads, ['callers']),
        callees: graphValues(payloads, ['callees']), tests: [...new Set([...fallback.tests, ...graphValues(payloads, ['tests', 'related_tests'])])],
        affectedFlows: graphValues(payloads, ['affected_flows', 'flows']), riskFeatures: graphValues(payloads, ['risk_features', 'risks']),
        architectureContext: graphText, estimatedTokens, baselineTokens: baseline.estimatedTokens, savedTokens: baseline.estimatedTokens - estimatedTokens, source: 'graph' };
    } catch {
      return this.fallback.getContext(task, changedFiles, tokenBudget);
    } finally { await client.close().catch(() => undefined); }
  }
}

export class ContextCompiler {
  compile(task: string, context: CodeContext, skills: Skill[], budget: number): { prompt: string; tokens: number; selectedFiles: string[] } {
    const limit = Math.floor(budget * 0.62);
    const taskPart = `Task: ${task}`;
    if (estimateTokens(taskPart) > limit) throw new Error('Task text exceeds the context budget');
    const architectureAllowance = Math.max(0, Math.min(Math.floor(limit * 0.2), limit - estimateTokens(taskPart) - 10));
    const architecture = context.architectureContext.slice(0, architectureAllowance * 4);
    const parts = [taskPart, `Architecture: ${architecture}`];
    const relations: [string, string[]][] = [
      ['Symbols', context.relevantSymbols], ['Dependencies', context.dependencies], ['Callers', context.callers],
      ['Callees', context.callees], ['Relevant tests', context.tests], ['Affected flows', context.affectedFlows],
      ['Risk features', context.riskFeatures],
    ];
    for (const [label, values] of relations) {
      const item = `${label}: ${values.slice(0, 12).join(', ')}`;
      if (values.length && estimateTokens(parts.join('\n') + item) <= limit) parts.push(item);
    }
    const selectedFiles: string[] = [];
    for (const skill of skills) {
      const part = `Skill ${skill.id}: ${skill.instructions}`;
      if (estimateTokens(parts.join('\n') + part) <= limit) parts.push(part);
    }
    for (const snippet of context.snippets) {
      const part = `File ${snippet.path}:\n${snippet.text}`;
      if (estimateTokens(parts.join('\n') + part) <= limit) { parts.push(part); selectedFiles.push(snippet.path); }
    }
    return { prompt: parts.join('\n\n'), tokens: estimateTokens(parts.join('\n\n')), selectedFiles };
  }
}
