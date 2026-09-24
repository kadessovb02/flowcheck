FlowCheck now runs from a prebuilt package, without cloning this repository or building TypeScript.

```bash
npx --yes https://github.com/kadessovb02/flowcheck/releases/download/v0.2.0/flowcheck.tgz demo
```

- `check <url> --text "Welcome"`: check a page without a scenario file or AI agent.
- `demo`: try a complete user journey on a bundled app, using a free local port.
- Chromium downloads on first use and is reused on subsequent runs.
- `connect codex` / `connect claude`: register MCP tools for the current project using the installed client CLI.
- MCP accepts inline scenarios and exposes their schema; an agent can validate and run a journey without writing a file first.
- `--json`: machine-readable results for scripts and agents that use the CLI.
- HTTP 4xx/5xx navigation responses now fail a check instead of being treated as a successful page load.

Requires Node.js 22.18+ and supports Chromium on macOS and Linux. On minimal Linux installations, `setup --with-deps` installs required system libraries and may require administrator privileges. No account, API key, or AI agent is required to run checks.

This is an early developer preview. A page smoke check is not a complete application test. Screenshot masks do not redact traces, URLs, or error messages; keep test evidence private.

The package is built and tested from this tag in GitHub Actions. `SHA256SUMS` contains its checksum. npm registry publication is separate; use the release URL above.
