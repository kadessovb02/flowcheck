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

## Pull requests

1. Open an issue for a substantial behavior or DSL change.
2. Keep the deterministic runner boundary: no hidden AI calls, shell execution, or arbitrary page JavaScript.
3. Add a regression test for observable behavior.
4. Run `npm run check` and `npm run build`.
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

## Reporting bugs

Use the issue template and provide a minimal public reproduction. For security problems, follow [SECURITY.md](SECURITY.md) instead.
