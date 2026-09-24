import { validateScenario, type Scenario } from './schema.ts';

export function pageScenario(url: string, text?: string): Scenario {
  return validateScenario({
    version: 1,
    name: 'Page smoke check',
    baseUrl: url,
    evidence: { screenshots: 'always', trace: true },
    steps: [
      { id: 'open-page', action: 'goto', path: url },
      { id: 'page-visible', action: 'assertVisible', target: { css: 'body' } },
      ...(text === undefined ? [] : [{ id: 'expected-text', action: 'assertText', text }]),
    ],
  });
}
