<p align="center">
  <img src="docs/assets/flowcheck-mark.svg" width="72" height="72" alt="FlowCheck logo">
</p>

<h1 align="center">FlowCheck Local</h1>

<p align="center">
  Turn AI-written browser checks into repeatable tests with evidence.
</p>

<p align="center">
  <a href="https://github.com/kadessovb02/flowcheck/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/kadessovb02/flowcheck/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@kadessovb/flowcheck"><img alt="npm version" src="https://img.shields.io/npm/v/@kadessovb/flowcheck"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-111827"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%3E%3D22.18-339933?logo=node.js&logoColor=white">
  <img alt="Playwright" src="https://img.shields.io/badge/browser-Playwright-2EAD33?logo=playwright&logoColor=white">
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/scenario-format.md">Scenario DSL</a> ·
  <a href="#use-with-a-coding-agent">MCP</a> ·
  <a href="README.ru.md">Русский</a>
</p>

---

**Your coding agent changed the UI. Does the user journey still work?**

FlowCheck Local replays a JSON scenario in Chromium and saves a pass/fail report, screenshots, a Playwright trace, and JUnit XML. Review the steps once, commit them, and rerun the same checks from the CLI or an MCP client after the next change.

**Runs on localhost. No FlowCheck account, API key, or model call required by the runner.**

```text
You or your agent → reviewable JSON scenario → Chromium → pass/fail + evidence
```

Use it for small smoke checks such as signup, form submission, and navigation. The runner executes the steps you supply; an AI agent can help write them before a run.

[Try the demo](#quickstart) · [See it catch a failure](#see-it-catch-a-failure) · [Choose the right tool](#how-it-fits-with-playwright)

## Quickstart

Requires **Node.js 22.18+** on macOS or Linux. Run from any directory:

```bash
npx --yes @kadessovb/flowcheck demo
```

That is the complete setup: npm fetches the published package, FlowCheck downloads Chromium if missing, starts its bundled app on a free port, checks a real user journey, and saves evidence in your current directory. Later runs reuse the caches. No Git clone, build step, account, or AI subscription is needed.

First use requires an internet connection and space for Chromium. Minimal Linux installations may also need system libraries: run the same command with `setup --with-deps` instead of `demo`. This explicit command may request administrator privileges; regular runs never install OS packages.

No project installation is required for the commands below. To pin FlowCheck in your project dependencies instead:

```bash
npm install --save-dev @kadessovb/flowcheck
npx flowcheck --help
```

With a project installation, you can use `npx flowcheck` as a shorter alias. Published packages are available on [npm](https://www.npmjs.com/package/@kadessovb/flowcheck); versioned archives are also available through [GitHub Releases](https://github.com/kadessovb02/flowcheck/releases).

## Check your app without an agent

Start your application, then run:

```bash
npx @kadessovb/flowcheck check http://localhost:3000
npx @kadessovb/flowcheck check http://localhost:3000/login --text "Sign in"
```

A page check requires a successful HTTP navigation and a visible page; `--text` also checks for the expected visible text. **It does not claim to test every user journey.** Use a scenario for interactions such as filling and submitting a form.

Add `--headed` to watch Chromium, or `--json` for a machine-readable result. Validation and setup errors return exit code `2`, failed checks return `1`, and successful checks return `0`.

## Use with a coding agent

From the project you want to test, choose your installed client:

```bash
npx @kadessovb/flowcheck connect codex
```

```bash
npx @kadessovb/flowcheck connect claude
```

The command prepares Chromium and uses the client's CLI to register a version-pinned stdio MCP server. It sets this project as the workspace and uses a project-specific server name, so connecting another project does not replace it. Codex stores the registration in its user configuration; Claude Code uses local project scope. Restart the client session after connecting. The `codex` or `claude` command must be on your PATH.

Then ask your agent:

> Use FlowCheck to check my app at http://localhost:3000. Validate the signup journey using the actual labels in the code, run it, and show me the failed step and evidence if it breaks.

The agent can pass a scenario **directly to MCP**. No manual JSON file is required. Save useful scenarios in your repository when you want to repeat them later.

| Tool | What it does |
|---|---|
| `flowcheck_check_page` | Checks a URL and optional visible text without a scenario file |
| `flowcheck_validate_scenario` | Validates inline JSON or a workspace scenario file without launching a browser |
| `flowcheck_run_scenario` | Runs inline JSON or a workspace file and returns step results and evidence paths |
| `flowcheck_latest_report` | Reads the latest completed result in the session |

For another client that supports **local stdio MCP**, run `npx @kadessovb/flowcheck config` and copy the generated entry into its MCP configuration. It includes your workspace path. `npx @kadessovb/flowcheck mcp` also starts the server directly. Clients that only accept remote HTTP servers need a different transport; this release is local stdio only.

Agents with terminal access can use `npx @kadessovb/flowcheck check ... --json` and `npx @kadessovb/flowcheck run ... --json` without MCP. FlowCheck runs the checks; your chosen agent provides the reasoning.

Configuration references: [Codex MCP](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## See it catch a failure

```bash
npx @kadessovb/flowcheck demo --broken
```

The demo app now shows an error when creating a workspace. The same assertions fail at `confirmation`, skip the remaining URL assertion, and save the failure screenshot and trace. `FAILED` and exit code **1** are expected here.

```text
✓ open-home · goto
✓ enter-email · fill
✓ enter-company · fill
✓ create-workspace · click
✗ confirmation · assertText

FAILED
Evidence: .../.flowcheck/runs/<run-id>
```

<p align="center">
  <img src="docs/assets/demo-failure.png" width="720" alt="Actual FlowCheck failure screenshot: the work email is masked and the demo shows a workspace creation error.">
</p>

This is a real screenshot from the public demo. Run `npx @kadessovb/flowcheck demo` to see the journey pass, or add `--headed` to watch either version.

## Save a repeatable journey

```bash
npx @kadessovb/flowcheck init --url http://localhost:3000
```

Edit the generated `flowcheck.scenario.json` to describe the journey you want to protect:

```json
{
  "version": 1,
  "name": "Create a workspace",
  "baseUrl": "http://localhost:3000",
  "evidence": { "screenshots": "on-failure", "trace": true },
  "steps": [
    { "id": "open", "action": "goto", "path": "/" },
    { "id": "email", "action": "fill", "target": { "label": "Work email" }, "value": "developer@example.com" },
    { "id": "company", "action": "fill", "target": { "label": "Company name" }, "value": "Acme" },
    { "id": "create", "action": "click", "target": { "role": "button", "name": "Create workspace" } },
    { "id": "confirm", "action": "assertText", "text": "Workspace Acme is ready", "exact": true }
  ]
}
```

Replace the example labels and text with those in your application, then run:

```bash
npx @kadessovb/flowcheck validate flowcheck.scenario.json
npx @kadessovb/flowcheck run --headed
```

The same JSON object works as the `scenario` argument to the MCP validation and run tools. Alternatively, use `scenarioPath` for a file inside the configured workspace. See the [scenario reference](docs/scenario-format.md) for actions, locators, environment variables, and screenshot masking.

## What a run produces

```text
.flowcheck/runs/<run-id>/
├── report.json      # versioned machine-readable result
├── junit.xml        # CI-compatible result
├── trace.zip        # Playwright trace, when enabled
└── *.png            # screenshots, according to the scenario policy
```

Use `--output <directory>` to choose where evidence is saved. Keep `.flowcheck/` out of source control. Open a trace with:

```bash
npx playwright show-trace .flowcheck/runs/<run-id>/trace.zip
```

The [CI workflow](.github/workflows/ci.yml) exercises successful and failed runs and saves the public demo evidence.

## How it fits with Playwright

FlowCheck uses Playwright underneath. Choose based on the workflow you need:

| Tool | A good fit when you want… |
|---|---|
| [Playwright Test](https://playwright.dev/docs/intro) | A full suite written in code, fixtures, multiple browsers, and parallel execution. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | An agent that explores a browser interactively and chooses its next action. |
| **FlowCheck Local** | A small, reviewed JSON journey replayed through CLI or MCP, with local evidence and no model decisions during execution. |

Already happy with a Playwright suite? Keep it. FlowCheck focuses on small smoke checks that a developer or agent can run and repeat quickly.

## Troubleshooting

- **Chromium download failed:** check your network, then run `npx @kadessovb/flowcheck setup`.
- **Missing Linux libraries:** run `npx @kadessovb/flowcheck setup --with-deps` explicitly.
- **Offline or managed environment:** provision Chromium with `setup` first, then set `FLOWCHECK_SKIP_BROWSER_INSTALL=1` to prevent automatic browser downloads. Cache/install the npm package as well.
- **Agent CLI not found:** use `npx @kadessovb/flowcheck config` for a manual MCP entry. An AI client is optional for all CLI checks.
- **Wrong application or port:** start your app separately and pass its exact URL. FlowCheck starts only its bundled demo automatically.

## Security and status

FlowCheck is an **early developer preview**, supporting Chromium on macOS and Linux. The scenario and report formats are versioned but may change before a stable release.

Run checks only against systems you are authorized to test. Navigation is restricted to the scenario's origin. Prefer `valueFromEnv` for secrets and explicit screenshot masks. Masks do **not** redact traces, URLs, or error messages; treat evidence as potentially sensitive. No FlowCheck telemetry or model calls are made. npm package and browser downloads contact their distribution services.

See [SECURITY.md](SECURITY.md) and [architecture](docs/architecture.md). The local runner works independently of any hosted FlowCheck service.

## Contributing

Try one real journey and [tell us what failed or felt difficult](https://github.com/kadessovb02/flowcheck/issues/new/choose). For development from source, see [CONTRIBUTING.md](CONTRIBUTING.md).

If repeatable browser checks would help your workflow, **star the repository** to help others discover it.

## License

[Apache-2.0](LICENSE). The license covers this repository, not hosted services or FlowCheck trademarks.
