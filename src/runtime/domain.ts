export type TaskType = 'feature' | 'bugfix' | 'refactor' | 'migration' | 'security' | 'performance' | 'tests' | 'documentation' | 'architecture';
export type Tier = 'cheap' | 'standard' | 'strong';
export type Risk = 'low' | 'medium' | 'high';
export type Action = 'execute' | 'accept' | 'retry' | 'escalate';

export interface TaskDefinition {
  text: string;
  type: TaskType;
  complexity: Risk;
  risk: number;
  changedFiles: string[];
  expectedBlastRadius: Risk;
  requiredVerification: string[];
  securitySensitive: boolean;
  databaseImpact: boolean;
  publicApiImpact: boolean;
}

export interface CodeContext {
  relevantFiles: string[];
  relevantSymbols: string[];
  dependencies: string[];
  callers: string[];
  callees: string[];
  tests: string[];
  affectedFlows: string[];
  riskFeatures: string[];
  architectureContext: string;
  estimatedTokens: number;
  baselineTokens?: number;
  savedTokens?: number;
  snippets: { path: string; text: string; tokens: number }[];
  source: 'graph' | 'lexical';
}

export interface Skill {
  id: string;
  description: string;
  triggers: string[];
  requires: string[];
  dependencies: string[];
  inputs: string[];
  outputs: string[];
  tools: string[];
  verification: string[];
  risk: Risk;
  estimatedTokens: number;
  instructions: string;
}

export interface ControlDecision {
  action: Action;
  taskType: TaskType;
  complexity: Risk;
  risk: number;
  needPlanner: boolean;
  needReview: boolean;
  needSecurityReview: boolean;
  needSecondImplementation: boolean;
  modelTier: Tier;
  source: 'policy' | 'laya';
  reason?: string;
}

export interface WorkflowStep {
  id: string;
  kind: 'inspect' | 'plan' | 'implement' | 'verify' | 'impact' | 'review' | 'decision';
  dependsOn: string[];
  required: boolean;
}

export interface WorkflowDAG { steps: WorkflowStep[] }

export interface ModelConfig { tier: Tier; model?: string; inputUsdPerMillion?: number; cachedInputUsdPerMillion?: number; outputUsdPerMillion?: number }

export interface ModelResult {
  output: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number | null;
}

export interface RuntimeState {
  task: TaskDefinition;
  context: CodeContext;
  verification?: VerificationResult[];
  attempt: number;
}

export interface VerificationResult { name: string; passed: boolean; exitCode: number | null; durationMs: number; output: string }

export interface RuntimeEvent {
  runId: string;
  traceId?: string;
  spanId?: string;
  at: string;
  type: string;
  data: Record<string, unknown>;
}

export interface CodeContextProvider {
  getContext(task: string, changedFiles?: string[], tokenBudget?: number): Promise<CodeContext>;
}

export interface ControlPlane { decide(state: RuntimeState): Promise<ControlDecision> }

export interface CodingModel { run(prompt: string, model: ModelConfig, role: 'planner' | 'implementer' | 'reviewer'): Promise<ModelResult> }

export interface EventStore { append(event: RuntimeEvent): Promise<void>; read(): Promise<RuntimeEvent[]> }

export function estimateTokens(value: string): number { return Math.ceil(value.length / 4); }
