# Software engineering runtime

The opt-in `flowcheck-runtime` CLI lives beside the deterministic FlowCheck browser runner. Browser scenarios, MCP tools, and their evidence format are unchanged. The runtime uses Codex only for planning, implementation, and risk-triggered review. Classification, context selection, workflow construction, checks, and accounting run in ordinary code.

## Phase 0 audit and dependency map

The original package is a TypeScript/Node 22 CLI and MCP server. `src/schema.ts` validates browser scenarios; `src/runner.ts` executes them through Playwright; `src/cli.ts` and `src/mcp.ts` expose them. There were no coding-model, agent, task-persistence, or workflow abstractions. Browser reports under `.flowcheck/runs/` are not software-engineering trajectories. Existing verification uses typecheck, unit and browser end-to-end tests, build, and package smoke tests. The new code is isolated under `src/runtime/` and writes under `.flowcheck/runtime/`.

Dependency map: `cli → executor → domain ports`; `executor → context, control plane, coding model, verifier, event store`; `context → optional code-review-graph MCP`; `control → optional Laya HTTP`; `coding model → Codex CLI`. Provider details stay in adapters.

## Commands

```sh
npm run build
node dist/src/runtime/cli.js plan 'Fix browser navigation bug'
node dist/src/runtime/cli.js run 'Fix browser navigation bug' --e2e
node dist/src/runtime/cli.js metrics
node dist/src/runtime/cli.js metrics --serve --port 8787
node dist/src/runtime/cli.js benchmark-run 'Fix browser navigation bug' --mode vanilla_codex
node dist/src/runtime/cli.js benchmark
```

The package also exposes `flowcheck-runtime`. `plan` calls no coding model. `run` requires a clean Git worktree, then invokes the installed `codex` executable with a workspace-write sandbox. A task mentioning a protected operation is blocked before invocation. The changed patch is checked again before verification, including staged and untracked files. An implementation can edit the supplied workspace. These checks do not inspect every shell action Codex may produce, so they are not a production deployment authorization boundary.

The compiler chooses a task type, risk, up to three dependency-aware skills, a bounded context slice, and a DAG. The executor follows DAG dependencies. It runs typecheck, unit tests, and build after each patch; relevant browser tasks or `--e2e` also run browser tests. Failed checks trigger one retry and then escalation. High-risk tasks add planning and independent review. Findings or an invalid reviewer response escalate. Every step, model call, routing decision, verification result, impact query, and outcome is appended to local JSONL with trace and span IDs compatible with OpenTelemetry identifier formats. Check output and review text can be sensitive; keep `.flowcheck/` private.

## Optional adapters

`code-review-graph` must be installed separately and indexed in the target repository. The adapter connects to its MCP server and asks for minimal context, semantic results, impact radius, and affected flows when available. If absent or failing, tracked files are ranked lexically and excerpted within the budget. The `source` field records which path ran. See [code-review-graph](https://github.com/tirth8205/code-review-graph).

For each query the adapter estimates both graph and lexical context sizes and uses graph output only when it is smaller. `baselineTokens` and `savedTokens` are local estimates based on text length; Codex usage events remain the source for actual model tokens.

If the graph CLI is wrapped by another executable, set `CODE_REVIEW_GRAPH_COMMAND` and `CODE_REVIEW_GRAPH_PREFIX_ARGS` (a JSON array of arguments preceding `serve`).

Set `ENABLE_LAYA=true` and `LAYA_URL=http://127.0.0.1:8000/predict` to use a local Laya service. The adapter asks for complexity and review need in one typed request. Laya may raise the policy's risk treatment but cannot lower it. HTTP errors, timeouts, or malformed answers fall back to deterministic rules. See [Laya](https://github.com/NandhaKishorM/laya).

The initial skills encode selected [Superpowers](https://github.com/obra/superpowers) workflow ideas as structured entries. The runtime does not require or install that plugin. Project skills can be added as JSON manifests in `runtime-skills/`; `runtime-skills/browser-regression.json` is an example. The `codex_superpowers` benchmark mode tests methodology instructions, not the installed plugin itself.

| Setting | Default | Effect |
| --- | --- | --- |
| `ENABLE_CODE_GRAPH` | `true` | Try graph MCP, fall back to lexical retrieval |
| `ENABLE_SKILL_GRAPH` | `true` | Select structured skills |
| `ENABLE_LAYA` | `false` | Use Laya for upward risk decisions |
| `ENABLE_ADAPTIVE_ROUTING` | `true` | Choose cheap, standard, or strong model tier |
| `ENABLE_EXPERIENCE_STORE` | `true` | Persist local JSONL events |
| `ENABLE_MULTI_AGENT` | `false` | Reserved for parallel independent implementations |
| `RUNTIME_CONTEXT_BUDGET` | `32000` | Total prompt budget with output reserve |
| `RUNTIME_MODEL_CHEAP`, `RUNTIME_MODEL_STANDARD`, `RUNTIME_MODEL_STRONG` | Codex default | Optional model IDs by tier |
| `RUNTIME_MODEL_<TIER>_INPUT_USD_PER_MILLION`, `RUNTIME_MODEL_<TIER>_OUTPUT_USD_PER_MILLION` | unset | Optional price assumptions for cost estimates |
| `RUNTIME_MODEL_<TIER>_CACHED_INPUT_USD_PER_MILLION` | input price | Optional cached-input price assumption |

No model price is assumed. Cost stays `null` until both input and output prices for a tier are configured. Codex JSON events provide token counts, including cached input when reported. The reported cost is an estimate from those prices, not provider billing data. Runtime prompt tokens and Codex's total input tokens are separate metrics.

## Benchmark and observability

`benchmark-run` creates fresh detached worktrees from the same `HEAD` for `vanilla_codex`, `codex_superpowers`, `codex_code_graph`, and `full_runtime`. It keeps patches under `.flowcheck/runtime/benchmarks/<session>/` and removes the temporary worktrees. The graph-only mode fails explicitly without a graph. Run one mode at a time with `--mode`, or omit it for all four. The command invokes coding models and can incur cost. `benchmark` aggregates recorded sessions; `metrics` reports success, tokens, cost when known, calls, retries, duration, skill usage, and routing. `metrics --serve` exposes the same JSON at `http://127.0.0.1:8787/metrics` for local dashboards. Do not infer savings or quality gains from an empty report or one task.

For benchmark records, `accepted` means configured checks passed. A task-specific assertion or human review is still needed to establish that the requested behavior was implemented.

## Current limits

- Graph MCP schemas and output vary across releases. The adapter discovers optional fields and keeps a lexical fallback; an installed-graph integration test is still needed.
- Skills use typed built-ins and JSON manifests, with lexical ranking and historical utility. Semantic embeddings are not implemented.
- JSONL is a local event store, not a transactional multi-user database.
- The context budget constrains text assembled by this runtime. Codex CLI can add its own instructions, history, and tool output; its reported total input tokens can be much larger.
- Verification uses this project's scripts. Security scanners and database validation need project-specific tools before becoming gates.
- Parallel implementations and automated acceptance of destructive operations are not enabled.
- No token saving or quality gain is claimed until representative benchmark sessions are collected.

An actual end-to-end smoke trace from a temporary arithmetic fixture is in [runtime-trace.jsonl](runtime-trace.jsonl). Codex changed `add(a, b)` from subtraction to addition, and typecheck, unit tests, and build passed. The trace was captured before `promptTokens` was added to context events; later runs include that field.
