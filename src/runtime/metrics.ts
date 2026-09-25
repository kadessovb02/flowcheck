import type { RuntimeEvent } from './domain.ts';

export interface RuntimeMetrics {
  tasks: number;
  successfulTasks: number;
  successRate: number;
  modelCalls: number;
  retries: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextTokens: number;
  graphContextSavedTokens: number;
  totalCostUsd: number | null;
  costPerSuccessfulTaskUsd: number | null;
  tokensPerSuccessfulTask: number | null;
  successfulTasksPerHour: number | null;
  skillUsage: Record<string, number>;
  skillAnalytics: Record<string, SkillAnalytics>;
  controlDecisions: Record<string, number>;
  modelRoutes: Record<string, number>;
}

export interface SkillAnalytics {
  usageCount: number;
  successRate: number;
  avgTokens: number;
  avgCostUsd: number | null;
  avgLatencyMs: number;
  retryRate: number;
  defectRate: number;
  humanInterventionRate: number;
}

export function aggregateMetrics(events: RuntimeEvent[]): RuntimeMetrics {
  const runs = new Set(events.map((event) => event.runId));
  const successes = events.filter((event) => event.type === 'outcome' && event.data.status === 'accepted');
  const calls = events.filter((event) => event.type === 'model_call');
  const costs = calls.map((event) => event.data.costUsd);
  const durationMs = events.filter((event) => event.type === 'outcome').reduce((sum, event) => sum + Number(event.data.durationMs ?? 0), 0);
  const count = (type: string, key: string) => events.filter((event) => event.type === type).reduce<Record<string, number>>((result, event) => {
    const value = String(event.data[key] ?? 'unknown'); result[value] = (result[value] ?? 0) + 1; return result;
  }, {});
  const skillUsage: Record<string, number> = {};
  for (const event of events.filter((item) => item.type === 'skills')) {
    for (const id of event.data.ids as string[]) skillUsage[id] = (skillUsage[id] ?? 0) + 1;
  }
  const inputTokens = calls.reduce((sum, event) => sum + Number(event.data.inputTokens ?? 0), 0);
  const cachedInputTokens = calls.reduce((sum, event) => sum + Number(event.data.cachedInputTokens ?? 0), 0);
  const outputTokens = calls.reduce((sum, event) => sum + Number(event.data.outputTokens ?? 0), 0);
  const totalCostUsd = costs.every((value) => typeof value === 'number') ? costs.reduce<number>((sum, value) => sum + Number(value), 0) : null;
  return { tasks: runs.size, successfulTasks: successes.length, successRate: runs.size ? successes.length / runs.size : 0,
    modelCalls: calls.length, retries: events.filter((event) => event.type === 'step' && event.data.id === 'implement' && Number(event.data.attempt) > 1).length,
    inputTokens, cachedInputTokens, outputTokens, contextTokens: events.filter((event) => event.type === 'context').reduce((sum, event) => sum + Number(event.data.promptTokens ?? event.data.estimatedTokens ?? 0), 0),
    graphContextSavedTokens: events.filter((event) => event.type === 'context' && event.data.source === 'graph').reduce((sum, event) => sum + Number(event.data.savedTokens ?? 0), 0),
    totalCostUsd, costPerSuccessfulTaskUsd: successes.length && totalCostUsd !== null ? totalCostUsd / successes.length : null,
    tokensPerSuccessfulTask: successes.length ? (inputTokens + outputTokens) / successes.length : null,
    successfulTasksPerHour: durationMs ? successes.length / (durationMs / 3_600_000) : null,
    skillUsage, skillAnalytics: aggregateSkillAnalytics(events), controlDecisions: count('control', 'action'), modelRoutes: count('routing', 'tier') };
}

export function compareBenchmarks(events: RuntimeEvent[]): Record<string, RuntimeMetrics> {
  const modes = new Map<string, string>();
  for (const event of events) if (event.type === 'benchmark_mode') modes.set(event.runId, String(event.data.mode));
  return Object.fromEntries([...new Set(modes.values())].map((mode) => [mode, aggregateMetrics(events.filter((event) => modes.get(event.runId) === mode))]));
}

export function skillUtility(events: RuntimeEvent[]): (id: string) => number {
  const analytics = aggregateSkillAnalytics(events);
  return (id) => {
    const item = analytics[id];
    if (!item || item.usageCount < 3) return 0;
    return item.successRate - item.avgTokens * 0.00001 - (item.avgCostUsd ?? 0) * 0.02 - item.avgLatencyMs * 0.000001 -
      item.retryRate * 0.2 - item.defectRate * 0.3 - item.humanInterventionRate * 0.2;
  };
}

export function aggregateSkillAnalytics(events: RuntimeEvent[]): Record<string, SkillAnalytics> {
  const byRun = new Map<string, RuntimeEvent[]>();
  for (const event of events) byRun.set(event.runId, [...(byRun.get(event.runId) ?? []), event]);
  const stats = new Map<string, { uses: number; successes: number; tokens: number; costs: number; priced: number; latency: number; retries: number; defects: number; interventions: number }>();
  for (const trajectory of byRun.values()) {
    const selected = trajectory.find((event) => event.type === 'skills')?.data.ids as string[] | undefined;
    if (!selected) continue;
    const success = trajectory.some((event) => event.type === 'outcome' && event.data.status === 'accepted');
    const calls = trajectory.filter((event) => event.type === 'model_call');
    const tokens = calls.reduce((sum, event) => sum + Number(event.data.inputTokens ?? 0) + Number(event.data.outputTokens ?? 0), 0);
    const priced = calls.length > 0 && calls.every((event) => typeof event.data.costUsd === 'number');
    const cost = priced ? calls.reduce((sum, event) => sum + Number(event.data.costUsd), 0) : 0;
    const latency = calls.reduce((sum, event) => sum + Number(event.data.latencyMs ?? 0), 0);
    const retries = trajectory.filter((event) => event.type === 'step' && event.data.id === 'implement' && Number(event.data.attempt) > 1).length;
    const defects = trajectory.filter((event) => event.type === 'review').reduce((sum, event) => sum + (Array.isArray(event.data.findings) ? event.data.findings.length : 0), 0);
    const intervention = trajectory.some((event) => event.type === 'outcome' && ['escalated', 'blocked'].includes(String(event.data.status)));
    for (const id of selected) {
      const current = stats.get(id) ?? { uses: 0, successes: 0, tokens: 0, costs: 0, priced: 0, latency: 0, retries: 0, defects: 0, interventions: 0 };
      current.uses++; current.successes += Number(success); current.tokens += tokens; current.costs += cost; current.priced += Number(priced);
      current.latency += latency; current.retries += retries; current.defects += Number(defects > 0); current.interventions += Number(intervention);
      stats.set(id, current);
    }
  }
  return Object.fromEntries([...stats].map(([id, item]) => [id, { usageCount: item.uses, successRate: item.successes / item.uses,
    avgTokens: item.tokens / item.uses, avgCostUsd: item.priced === item.uses ? item.costs / item.uses : null,
    avgLatencyMs: item.latency / item.uses, retryRate: item.retries / item.uses, defectRate: item.defects / item.uses,
    humanInterventionRate: item.interventions / item.uses } satisfies SkillAnalytics]));
}
