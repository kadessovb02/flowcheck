# Architecture and trust boundaries

FlowCheck Local is deliberately smaller than the hosted FlowCheck platform.

```text
scenario.json ── validate ── policy ── Playwright ── authorized target
                                  └── evidence writer

MCP client ── stdio ── workspace path guard ── same validator and runner
```

## Invariants

1. Validation happens before Chromium starts.
2. A scenario contains typed actions, not JavaScript or shell commands.
3. Main-frame navigation cannot leave the `baseUrl` origin.
4. Steps execute in order and stop at the first failure.
5. Reports preserve the exact scenario digest and never convert failure into success.
6. Environment-sourced values are not serialized into reports.
7. MCP scenario paths must resolve inside `FLOWCHECK_WORKSPACE_ROOT`.

## Open-source / hosted boundary

This repository owns local deterministic execution: DSL, validation, browser interaction, evidence, CLI, and MCP tools.

The hosted FlowCheck service may create and approve scenarios, coordinate teams, schedule runs, store evidence, analyze product coverage, and manage verified fixes. The local runner does not require those services and does not contain their implementation.

## Non-goals

- autonomous crawling or AI planning;
- changing assertions in response to a failure;
- running arbitrary repository code;
- storing credentials;
- multi-tenant cloud isolation;
- claiming that page visitation equals business-process coverage.
