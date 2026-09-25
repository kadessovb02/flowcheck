# Architecture and trust boundaries

FlowCheck Local is deliberately smaller than the hosted FlowCheck platform.

```text
scenario.json ── validate ── policy ── Playwright ── authorized target
                                  └── evidence writer

MCP client ── stdio ── inline scenario or guarded workspace file ── same validator and runner
```

## Invariants

1. Validation happens before Chromium starts.
2. A scenario contains typed actions, not JavaScript or shell commands.
3. Main-frame navigation cannot leave the `baseUrl` origin.
4. Steps execute in order and stop at the first failure.
5. Reports preserve the exact scenario digest and never convert failure into success.
6. Environment-sourced values are not serialized into reports.
7. MCP scenario paths must resolve inside the canonical workspace root; inline scenarios use the same validator.
8. A missing Chromium is installed through the bundled Playwright CLI before a browser run; no model or FlowCheck account is involved. `FLOWCHECK_SKIP_BROWSER_INSTALL=1` disables automatic downloads.

## Open-source / hosted boundary

This repository owns local deterministic execution: DSL, validation, browser interaction, evidence, CLI, and MCP tools.

The hosted FlowCheck service may create and approve scenarios, coordinate teams, schedule runs, store evidence, analyze product coverage, and manage verified fixes. The local runner does not require those services and does not contain their implementation.

The opt-in software engineering CLI is described in [software-engineering-runtime.md](software-engineering-runtime.md). It does not change browser scenario execution or MCP trust boundaries.

## Non-goals

- autonomous crawling or AI planning;
- changing assertions in response to a failure;
- running arbitrary repository code;
- storing credentials;
- multi-tenant cloud isolation;
- claiming that page visitation equals business-process coverage.
