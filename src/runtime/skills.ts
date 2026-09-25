import type { CodeContext, Skill } from './domain.ts';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const skillSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/), description: z.string(), triggers: z.array(z.string()),
  requires: z.array(z.string()), dependencies: z.array(z.string()), inputs: z.array(z.string()),
  outputs: z.array(z.string()), tools: z.array(z.string()), verification: z.array(z.string()),
  risk: z.enum(['low', 'medium', 'high']), estimatedTokens: z.number().int().positive(), instructions: z.string(),
});

const primitive = (id: string, triggers: string[], instructions: string, dependencies: string[] = []): Skill => ({
  id, description: id.replaceAll('-', ' '), triggers, requires: [], dependencies, inputs: [], outputs: [], tools: [], verification: [], risk: 'low', estimatedTokens: Math.ceil(instructions.length / 4), instructions,
});

export const DEFAULT_SKILLS: Skill[] = [
  primitive('systematic-debugging', ['bug', 'fix', 'error', 'ошибка'], 'Reproduce the failure, locate its cause, then change the smallest relevant code.'),
  primitive('writing-plans', ['architecture', 'migration', 'complex', 'план'], 'State the intended edit and verification before implementation.'),
  primitive('test-driven-development', ['test', 'bug', 'feature', 'тест'], 'Add a meaningful failing test where practical, then implement and rerun it.'),
  primitive('verification-before-completion', ['verify', 'test', 'feature', 'bug', 'провер'], 'Run the required checks and report their actual outcomes.'),
  primitive('code-review', ['review', 'security', 'migration', 'api'], 'Review the diff for behavior, regression, and missing tests.', ['verification-before-completion']),
];

export class SkillRegistry {
  private readonly values = new Map<string, Skill>();
  constructor(skills: Skill[] = DEFAULT_SKILLS) { for (const skill of skills) this.add(skill); }
  add(skill: Skill): void {
    if (this.values.has(skill.id)) throw new Error(`Duplicate skill: ${skill.id}`);
    this.values.set(skill.id, skill);
  }
  get(id: string): Skill | undefined { return this.values.get(id); }
  all(): Skill[] { return [...this.values.values()]; }
  static async load(directory: string): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      const parsed: unknown = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      registry.add(skillSchema.parse(parsed));
    }
    return registry;
  }
}

export class SkillRetriever {
  private readonly registry: SkillRegistry;
  private readonly historicalUtility: (id: string) => number;
  constructor(registry: SkillRegistry, historicalUtility: (id: string) => number = () => 0) { this.registry = registry; this.historicalUtility = historicalUtility; }
  async retrieve(task: string, context: CodeContext, budget: number): Promise<Skill[]> {
    const haystack = `${task} ${context.riskFeatures.join(' ')}`.toLowerCase();
    const ranked = this.registry.all().map((skill) => ({ skill,
      score: skill.triggers.reduce((score, trigger) => score + (haystack.includes(trigger.toLowerCase()) ? 1 : 0), 0) + this.historicalUtility(skill.id),
    })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
    const selected = new Map<string, Skill>();
    const visit = (id: string, stack: Set<string>): Skill[] => {
      if (stack.has(id)) throw new Error(`Skill dependency cycle: ${id}`);
      const skill = this.registry.get(id);
      if (!skill) throw new Error(`Missing skill dependency: ${id}`);
      return [...skill.dependencies.flatMap((dependency) => visit(dependency, new Set([...stack, id]))), skill];
    };
    let used = 0;
    for (const { skill } of ranked) {
      if (selected.size >= 3) break;
      const bundle = visit(skill.id, new Set()).filter((item) => !selected.has(item.id));
      const cost = bundle.reduce((total, item) => total + item.estimatedTokens, 0);
      if (used + cost > budget || selected.size + bundle.length > 3) continue;
      bundle.forEach((item) => selected.set(item.id, item));
      used += cost;
    }
    return [...selected.values()];
  }
}
