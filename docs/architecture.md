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
4. Steps execute in order; a run stops at the first failure and marks remaining steps skipped. Suites continue with fresh browser contexts after assertion or invalid-file failures.
5. Reports preserve the executed scenario digest and, for base URL overrides, the source digest; they distinguish assertion failure, skipped work, and infrastructure error.
6. Environment-sourced values are not serialized into reports.
7. MCP scenario paths must resolve inside the canonical workspace root; inline scenarios use the same validator.
8. A missing Chromium is installed through the bundled Playwright CLI before a browser run; no model or FlowCheck account is involved. `FLOWCHECK_SKIP_BROWSER_INSTALL=1` disables automatic downloads.

The repository owns local scenario execution: DSL, validation, browser interaction, evidence, CLI, and MCP tools. Workspace and navigation restrictions reduce accidental scope changes; they are not a general sandbox. Browser behavior still depends on application state, timing, test data, and environment.

The opt-in software engineering CLI is described in [software-engineering-runtime.md](software-engineering-runtime.md). It does not change browser scenario execution or MCP trust boundaries.

## Browser scenario non-goals

- autonomous crawling or AI planning during scenario execution;
- changing assertions in response to a failure;
- running arbitrary repository code;
- storing credentials;
- multi-tenant cloud isolation;
- claiming that page visitation equals business-process coverage.
