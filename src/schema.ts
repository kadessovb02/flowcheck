export const SCENARIO_VERSION = 1 as const;

export type BrowserRole =
  | 'button' | 'checkbox' | 'combobox' | 'dialog' | 'heading' | 'link'
  | 'listbox' | 'menuitem' | 'option' | 'radio' | 'row' | 'tab'
  | 'textbox';

export interface Target {
  role?: BrowserRole;
  name?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  css?: string;
  exact?: boolean;
}

interface StepBase {
  id: string;
  description?: string;
}

interface TargetStep extends StepBase {
  target: Target;
}

export type ScenarioStep =
  | (StepBase & { action: 'goto'; path: string })
  | (TargetStep & { action: 'click' })
  | (TargetStep & { action: 'fill'; value?: string; valueFromEnv?: string; sensitive?: boolean })
  | (TargetStep & { action: 'select'; value: string })
  | (TargetStep & { action: 'check' | 'uncheck' })
  | (TargetStep & { action: 'press'; key: string })
  | (TargetStep & { action: 'waitFor' | 'assertVisible' })
  | (StepBase & { action: 'assertText'; text: string; exact?: boolean })
  | (StepBase & { action: 'assertUrl'; pattern: string });

export interface Scenario {
  version: typeof SCENARIO_VERSION;
  name: string;
  baseUrl: string;
  timeoutMs?: number;
  evidence?: {
    screenshots?: 'always' | 'on-failure' | 'off';
    trace?: boolean;
    mask?: Target[];
  };
  steps: ScenarioStep[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ScenarioValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Invalid FlowCheck scenario:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'ScenarioValidationError';
    this.issues = issues;
  }
}

const stepActions = new Set([
  'goto', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'waitFor',
  'assertVisible', 'assertText', 'assertUrl',
]);
const selectorKeys = ['role', 'label', 'placeholder', 'testId', 'text', 'css'] as const;
const targetStringKeys = ['name', 'label', 'placeholder', 'testId', 'text', 'css'] as const;
const targetActions = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'press', 'waitFor', 'assertVisible']);
const validRoles = new Set<BrowserRole>([
  'button', 'checkbox', 'combobox', 'dialog', 'heading', 'link', 'listbox',
  'menuitem', 'option', 'radio', 'row', 'tab', 'textbox',
]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown, max = 2_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validateTarget(value: unknown, path: string, issues: ValidationIssue[]): value is Target {
  if (!object(value)) {
    issues.push({ path, message: 'must be an object' });
    return false;
  }
  const selectors = selectorKeys.filter((key) => nonEmpty(value[key]));
  if (selectors.length === 0) issues.push({ path, message: 'requires one selector: role, label, placeholder, testId, text, or css' });
  if (selectors.length > 1) issues.push({ path, message: 'use one selector; role may be refined with name' });
  for (const key of targetStringKeys) {
    if (value[key] !== undefined && !nonEmpty(value[key])) issues.push({ path: `${path}.${key}`, message: 'must be a non-empty string up to 2000 characters' });
  }
  if (value.name !== undefined && value.role === undefined) issues.push({ path: `${path}.name`, message: 'is only valid together with role' });
  if (value.role !== undefined && !validRoles.has(value.role as BrowserRole)) issues.push({ path: `${path}.role`, message: 'unsupported ARIA role' });
  if (value.exact !== undefined && typeof value.exact !== 'boolean') issues.push({ path: `${path}.exact`, message: 'must be boolean' });
  return true;
}

export function validateScenario(value: unknown): Scenario {
  const issues: ValidationIssue[] = [];
  if (!object(value)) throw new ScenarioValidationError([{ path: '$', message: 'must be an object' }]);
  if (value.version !== SCENARIO_VERSION) issues.push({ path: '$.version', message: `must equal ${SCENARIO_VERSION}` });
  if (!nonEmpty(value.name, 160)) issues.push({ path: '$.name', message: 'must be a non-empty string up to 160 characters' });

  if (!nonEmpty(value.baseUrl)) {
    issues.push({ path: '$.baseUrl', message: 'must be an absolute http(s) URL' });
  } else {
    try {
      const url = new URL(value.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      issues.push({ path: '$.baseUrl', message: 'must be an absolute http(s) URL without embedded credentials' });
    }
  }

  if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 500 || Number(value.timeoutMs) > 120_000)) {
    issues.push({ path: '$.timeoutMs', message: 'must be an integer between 500 and 120000' });
  }

  if (value.evidence !== undefined) {
    if (!object(value.evidence)) issues.push({ path: '$.evidence', message: 'must be an object' });
    else {
      if (value.evidence.screenshots !== undefined && !['always', 'on-failure', 'off'].includes(String(value.evidence.screenshots))) {
        issues.push({ path: '$.evidence.screenshots', message: 'must be always, on-failure, or off' });
      }
      if (value.evidence.trace !== undefined && typeof value.evidence.trace !== 'boolean') issues.push({ path: '$.evidence.trace', message: 'must be boolean' });
      if (value.evidence.mask !== undefined) {
        if (!Array.isArray(value.evidence.mask) || value.evidence.mask.length > 20) issues.push({ path: '$.evidence.mask', message: 'must be an array with at most 20 targets' });
        else value.evidence.mask.forEach((target, index) => validateTarget(target, `$.evidence.mask[${index}]`, issues));
      }
    }
  }

  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 200) {
    issues.push({ path: '$.steps', message: 'must contain 1 to 200 steps' });
  } else {
    const ids = new Set<string>();
    value.steps.forEach((rawStep, index) => {
      const path = `$.steps[${index}]`;
      if (!object(rawStep)) { issues.push({ path, message: 'must be an object' }); return; }
      if (!nonEmpty(rawStep.id, 80) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(String(rawStep.id))) {
        issues.push({ path: `${path}.id`, message: 'must be a unique slug (letters, numbers, _ and -)' });
      } else if (ids.has(rawStep.id)) issues.push({ path: `${path}.id`, message: 'must be unique' });
      else ids.add(rawStep.id);
      if (!stepActions.has(String(rawStep.action))) { issues.push({ path: `${path}.action`, message: 'unsupported action' }); return; }
      const action = String(rawStep.action);
      if (targetActions.has(action)) validateTarget(rawStep.target, `${path}.target`, issues);
      if (action === 'goto' && !nonEmpty(rawStep.path)) issues.push({ path: `${path}.path`, message: 'is required' });
      if (action === 'fill') {
        const hasValue = typeof rawStep.value === 'string';
        const hasEnv = nonEmpty(rawStep.valueFromEnv, 160);
        if (hasValue === hasEnv) issues.push({ path, message: 'fill requires exactly one of value or valueFromEnv' });
        if (rawStep.sensitive !== undefined && typeof rawStep.sensitive !== 'boolean') issues.push({ path: `${path}.sensitive`, message: 'must be boolean' });
      }
      if (action === 'select' && !nonEmpty(rawStep.value)) issues.push({ path: `${path}.value`, message: 'is required' });
      if (action === 'press' && !nonEmpty(rawStep.key, 80)) issues.push({ path: `${path}.key`, message: 'is required' });
      if (action === 'assertText' && !nonEmpty(rawStep.text)) issues.push({ path: `${path}.text`, message: 'is required' });
      if (action === 'assertUrl' && !nonEmpty(rawStep.pattern)) issues.push({ path: `${path}.pattern`, message: 'is required' });
    });
  }

  if (issues.length > 0) throw new ScenarioValidationError(issues);
  return value as unknown as Scenario;
}

export function publicStep(step: ScenarioStep): Record<string, unknown> {
  if (step.action !== 'fill') return { ...step };
  return {
    ...step,
    value: step.value === undefined ? undefined : step.sensitive ? '[redacted]' : step.value,
    valueFromEnv: step.valueFromEnv,
  };
}

// Exposed to MCP clients so agents can construct scenarios without reading a file.
const stringInput = { type: 'string', minLength: 1, maxLength: 2_000 };
const targetInput = {
  type: 'object', additionalProperties: false,
  properties: {
    role: { type: 'string', enum: [...validRoles] },
    name: stringInput, label: stringInput, placeholder: stringInput,
    testId: stringInput, text: stringInput, css: stringInput, exact: { type: 'boolean' },
  },
  oneOf: selectorKeys.map((key) => ({ required: [key] })),
};
function actionInput(action: string, fields: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) {
  return {
    type: 'object', additionalProperties: false,
    properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]*$', maxLength: 80 }, description: { type: 'string' }, action: { const: action }, ...fields },
    required: ['id', 'action', ...required], ...extra,
  };
}
export const scenarioInputSchema = {
  type: 'object', additionalProperties: false, required: ['version', 'name', 'baseUrl', 'steps'],
  properties: {
    version: { const: 1 }, name: { type: 'string', minLength: 1, maxLength: 160 },
    baseUrl: { ...stringInput, description: 'Absolute HTTP(S) URL for the application, e.g. http://localhost:3000.' },
    timeoutMs: { type: 'integer', minimum: 500, maximum: 120_000 },
    evidence: {
      type: 'object', additionalProperties: false,
      properties: {
        screenshots: { enum: ['always', 'on-failure', 'off'] }, trace: { type: 'boolean' },
        mask: { type: 'array', maxItems: 20, items: targetInput },
      },
    },
    steps: {
      type: 'array', minItems: 1, maxItems: 200,
      items: { oneOf: [
        actionInput('goto', { path: stringInput }, ['path']),
        ...['click', 'check', 'uncheck', 'waitFor', 'assertVisible'].map((action) => actionInput(action, { target: targetInput }, ['target'])),
        actionInput('fill', { target: targetInput, value: { type: 'string' }, valueFromEnv: { type: 'string', minLength: 1, maxLength: 160 }, sensitive: { type: 'boolean' } }, ['target'], { oneOf: [{ required: ['value'] }, { required: ['valueFromEnv'] }] }),
        actionInput('select', { target: targetInput, value: stringInput }, ['target', 'value']),
        actionInput('press', { target: targetInput, key: { type: 'string', minLength: 1, maxLength: 80 } }, ['target', 'key']),
        actionInput('assertText', { text: stringInput, exact: { type: 'boolean' } }, ['text']),
        actionInput('assertUrl', { pattern: stringInput }, ['pattern']),
      ] },
    },
  },
};
