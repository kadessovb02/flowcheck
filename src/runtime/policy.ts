import type { CodeContext, ControlDecision, ModelConfig, RuntimeState, TaskDefinition, TaskType, WorkflowDAG, WorkflowStep } from './domain.ts';

const signals: [TaskType, RegExp][] = [
  ['security', /security|vulnerab|auth|secret|credential|безопас|уязвим/i],
  ['migration', /migration|schema|database|postgres|миграц|схем/i],
  ['bugfix', /bug|fix|error|crash|исправ|ошиб/i],
  ['performance', /performance|optimi[sz]|latency|производител/i],
  ['tests', /\btest|тест/i],
  ['documentation', /\bdocs?|readme|документ/i],
  ['refactor', /refactor|рефактор/i],
  ['architecture', /architect|архитект/i],
];

export class TaskCompiler {
  compile(text: string, changedFiles: string[] = []): TaskDefinition {
    if (!text.trim()) throw new Error('Task text is required');
    const type = signals.find(([, pattern]) => pattern.test(text))?.[0] ?? 'feature';
    const securitySensitive = /security|auth|secret|credential|безопас|уязвим/i.test(text) || changedFiles.some((f) => /auth|secret|security/i.test(f));
    const databaseImpact = /database|schema|migration|postgres|sqlite|миграц|баз[аыу] данных/i.test(text) || changedFiles.some((f) => /migrat|schema|\.sql$/i.test(f));
    const publicApiImpact = /public api|breaking|export|cli|mcp|публичн/i.test(text);
    const risk = Math.min(1, 0.15 + (securitySensitive ? 0.35 : 0) + (databaseImpact ? 0.3 : 0) + (publicApiImpact ? 0.2 : 0) + (changedFiles.length > 4 ? 0.2 : 0));
    const complexity = risk >= 0.7 ? 'high' : risk >= 0.4 || changedFiles.length > 2 ? 'medium' : 'low';
    const expectedBlastRadius = changedFiles.length > 4 || publicApiImpact ? 'high' : changedFiles.length > 1 || databaseImpact ? 'medium' : 'low';
    const browserImpact = /browser|navigation|scenario|playwright|chromium|браузер/i.test(text) || changedFiles.some((file) => /browser|runner|scenario|mcp/i.test(file));
    const requiredVerification = ['typecheck', 'test:unit', 'build', ...(browserImpact ? ['test:e2e'] : [])];
    return { text, type, complexity, risk, changedFiles, expectedBlastRadius, requiredVerification, securitySensitive, databaseImpact, publicApiImpact };
  }
}

export class DeterministicControlPlane {
  async decide(state: RuntimeState): Promise<ControlDecision> {
    const { task, verification, attempt } = state;
    const failed = verification?.some((result) => !result.passed) ?? false;
    const action = failed ? (attempt >= 2 ? 'escalate' : 'retry') : verification ? 'accept' : 'execute';
    return { action, taskType: task.type, complexity: task.complexity, risk: task.risk,
      needPlanner: task.complexity === 'high', needReview: task.risk >= 0.55 || task.securitySensitive || task.databaseImpact,
      needSecurityReview: task.securitySensitive, needSecondImplementation: false,
      modelTier: task.complexity === 'high' ? 'strong' : task.complexity === 'medium' ? 'standard' : 'cheap', source: 'policy' };
  }
}

export class ModelRouter {
  private readonly models: Partial<Record<ModelConfig['tier'], ModelConfig>>;
  constructor(models: Partial<Record<ModelConfig['tier'], ModelConfig>> = {}) { this.models = models; }
  select(_task: TaskDefinition, control: ControlDecision): ModelConfig {
    return this.models[control.modelTier] ?? { tier: control.modelTier };
  }
}

export class WorkflowCompiler {
  compile(task: TaskDefinition, _context: CodeContext, policy: ControlDecision): WorkflowDAG {
    const steps: WorkflowStep[] = [];
    const add = (id: string, kind: WorkflowStep['kind'], required = true) => {
      steps.push({ id, kind, required, dependsOn: steps.length ? [steps[steps.length - 1]!.id] : [] });
    };
    add('inspect', 'inspect');
    if (policy.needPlanner) add('plan', 'plan');
    add('implement', 'implement');
    add('verify', 'verify');
    add('impact', 'impact');
    if (policy.needReview) add('review', 'review');
    add('decision', 'decision');
    if (task.type === 'documentation') steps.find((step) => step.id === 'verify')!.required = false;
    return { steps };
  }
}

export class SafetyPolicy {
  assess(text: string): string[] {
    const rules: [string, RegExp][] = [
      ['force push', /\bforce[ -]push\b|git\s+push\s+[^\n]*--force/i],
      ['production deploy', /\bdeploy\b[^\n]*\bprod(?:uction)?\b|\bprod(?:uction)?\b[^\n]*\bdeploy\b/i],
      ['destructive migration', /\bdrop\s+(?:table|column|database)\b|destructive migration/i],
      ['secret or credential operation', /\b(?:rotate|change|delete|revoke)\b[^\n]*(?:secret|credential|token|password)/i],
      ['irreversible filesystem operation', /\brm\s+-rf\b|\bdelete\s+irreversibly\b/i],
    ];
    return rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  }
  assessPatch(nameStatus: string, diff: string): string[] {
    const violations: string[] = [];
    if (nameStatus.split('\n').some((line) => /^D\s/.test(line))) violations.push('tracked file deletion');
    if (nameStatus.split('\n').some((line) => /(?:^|[\/\t])(?:\.env(?:\.|$)|[^/]+\.(?:pem|key)$|secrets?\.[^/]+$)/i.test(line))) violations.push('secret file change');
    const additions = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
    if (/\bDROP\s+(?:TABLE|COLUMN|DATABASE)\b/i.test(additions)) violations.push('destructive database migration');
    if (/\bgit\s+push\b[^\n]*--force|\brm\s+-rf\b/i.test(additions)) violations.push('irreversible command added');
    return violations;
  }
}
