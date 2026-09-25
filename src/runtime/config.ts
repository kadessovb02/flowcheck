import path from 'node:path';
import type { ModelConfig } from './domain.ts';

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true or false`);
}

function price(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

export interface RuntimeConfig {
  root: string;
  contextBudget: number;
  enableCodeGraph: boolean;
  enableSkillGraph: boolean;
  enableLaya: boolean;
  enableAdaptiveRouting: boolean;
  enableExperienceStore: boolean;
  enableMultiAgent: boolean;
  models: Partial<Record<ModelConfig['tier'], ModelConfig>>;
  layaUrl: string;
}

export function loadRuntimeConfig(root = process.cwd()): RuntimeConfig {
  const contextBudget = Number(process.env.RUNTIME_CONTEXT_BUDGET ?? 32000);
  if (!Number.isSafeInteger(contextBudget) || contextBudget < 1000) throw new Error('RUNTIME_CONTEXT_BUDGET must be an integer >= 1000');
  return { root: path.resolve(root), contextBudget,
    enableCodeGraph: bool('ENABLE_CODE_GRAPH', true), enableSkillGraph: bool('ENABLE_SKILL_GRAPH', true),
    enableLaya: bool('ENABLE_LAYA', false), enableAdaptiveRouting: bool('ENABLE_ADAPTIVE_ROUTING', true),
    enableExperienceStore: bool('ENABLE_EXPERIENCE_STORE', true), enableMultiAgent: bool('ENABLE_MULTI_AGENT', false),
    models: {
      cheap: { tier: 'cheap', model: process.env.RUNTIME_MODEL_CHEAP,
        inputUsdPerMillion: price('RUNTIME_MODEL_CHEAP_INPUT_USD_PER_MILLION'), cachedInputUsdPerMillion: price('RUNTIME_MODEL_CHEAP_CACHED_INPUT_USD_PER_MILLION'),
        outputUsdPerMillion: price('RUNTIME_MODEL_CHEAP_OUTPUT_USD_PER_MILLION') },
      standard: { tier: 'standard', model: process.env.RUNTIME_MODEL_STANDARD,
        inputUsdPerMillion: price('RUNTIME_MODEL_STANDARD_INPUT_USD_PER_MILLION'), cachedInputUsdPerMillion: price('RUNTIME_MODEL_STANDARD_CACHED_INPUT_USD_PER_MILLION'),
        outputUsdPerMillion: price('RUNTIME_MODEL_STANDARD_OUTPUT_USD_PER_MILLION') },
      strong: { tier: 'strong', model: process.env.RUNTIME_MODEL_STRONG,
        inputUsdPerMillion: price('RUNTIME_MODEL_STRONG_INPUT_USD_PER_MILLION'), cachedInputUsdPerMillion: price('RUNTIME_MODEL_STRONG_CACHED_INPUT_USD_PER_MILLION'),
        outputUsdPerMillion: price('RUNTIME_MODEL_STRONG_OUTPUT_USD_PER_MILLION') },
    }, layaUrl: process.env.LAYA_URL ?? 'http://127.0.0.1:8000/predict' };
}
