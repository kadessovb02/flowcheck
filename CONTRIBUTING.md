# Contributing to FlowCheck Local

Thanks for helping make local browser checks more reliable.

## Development setup

```bash
git clone https://github.com/kadessovb02/flowcheck.git
cd flowcheck
npm ci
npx playwright install chromium
npm run check
```

Node.js 22.18 or newer is required.

## Code map and checks

- `src/schema.ts`: v1 scenario types, validation, MCP input schema.
- `src/runner.ts`: Playwright steps, evidence, JSON/JUnit run reports.
- `src/suite.ts` and `src/summary.ts`: ordered multi-file runs and CI summary.
- `src/cli.ts` and `src/mcp.ts`: command and MCP adapters.
- `tests/*.unit.test.ts`, `tests/*.e2e.test.ts`, and `scripts/test-package.mjs`: validation, browser, and installed-package checks.

Run `npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, then `npm run test:package`. `npm run check` runs the first three. Chromium must be installed for browser tests. For a runner regression, add a small local HTTP page in `tests/runner.e2e.test.ts`, show the failing assertion first, then implement the fix. For a CLI or suite regression, use `tests/suite.e2e.test.ts`.

## Pull requests

1. Open an issue for a substantial behavior or DSL change.
2. Keep the deterministic runner boundary: no hidden AI calls, shell execution, or arbitrary page JavaScript.
3. Add a regression test for observable behavior.
4. Run `npm run check` and `npm run test:package` (which also builds the package).
5. Do not commit `.flowcheck/`, credentials, customer data, traces, private screenshots, or private URLs. Documentation images may use the bundled public demo with synthetic data; review them before committing.
6. Explain compatibility and security impact in the pull request.

Contributions are accepted under the Apache-2.0 license. By submitting a contribution, you certify that you have the right to do so under the [Developer Certificate of Origin](https://developercertificate.org/). Add a sign-off with `git commit -s`.

## Design principles

- Accessible locators before CSS.
- Explicit failure before best-effort success.
- Version stored formats before extending them.
- Evidence tied to the exact executed scenario.
- Secrets remain references, never convenient plaintext.
- Small dependencies and clear trust boundaries.

Welcome contributions include focused regression tests, clearer diagnostics, CI examples using synthetic data, and small reporter improvements. Discuss DSL fields, report schema changes, or public API changes in an issue before coding so compatibility and migration can be reviewed. SaaS, accounts, dashboards, arbitrary shell/JavaScript in scenarios, and a general plugin framework are outside this repository's current scope.

## Reporting bugs

Use the issue template and provide a minimal public reproduction. For security problems, follow [SECURITY.md](SECURITY.md) instead.

## Testing the first-run experience

`npm run test:package` builds a tarball, serves it locally, and runs it through `npx` from an unrelated directory with a fresh npm cache. It verifies the bundled demo and MCP connection without access to the source checkout.

To also test an automatic Chromium download into a fresh temporary browser cache:

```bash
FLOWCHECK_TEST_FRESH_BROWSER=1 npm run test:package
```

## Releases

Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and `docs/release-notes.md` together. Push the matching `v<version>` tag after the checks pass. The release workflow scans for secrets, tests the package, and publishes `flowcheck.tgz` and its checksum from that tagged commit. Publish that tested archive to npm as a separate maintainer operation, then verify `npx --yes @kadessovb/flowcheck@<version> demo --json` from outside the repository.
