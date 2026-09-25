# FlowCheck Scenario DSL v1

The scenario is a JSON document. Version `1` is intentionally small: deterministic browser actions, stable locators, explicit assertions, and no arbitrary code.

## Top-level fields

| Field | Required | Description |
|---|---:|---|
| `version` | yes | Must be `1` |
| `name` | yes | Human-readable scenario name |
| `baseUrl` | yes | Absolute HTTP(S) URL without embedded credentials |
| `timeoutMs` | no | Per-action timeout, 500–120000 ms; default 15000 |
| `evidence` | no | Screenshot, trace, and masking policy |
| `steps` | yes | Ordered list of 1–200 actions |

## Targets

Prefer the first available option in this order:

```json
{ "role": "button", "name": "Save" }
{ "label": "Work email" }
{ "placeholder": "Search customers" }
{ "testId": "save-customer" }
{ "text": "Customer created" }
{ "css": "#legacy-submit" }
```

Only one selector strategy is allowed. `name` refines `role`; `exact` defaults to `true`. CSS is available for legacy interfaces but is the least stable option.

Supported roles: `button`, `checkbox`, `combobox`, `dialog`, `heading`, `link`, `listbox`, `menuitem`, `option`, `radio`, `row`, `tab`, and `textbox`.

## Actions

| Action | Additional fields | Behavior |
|---|---|---|
| `goto` | `path` | Opens a URL relative to `baseUrl`; HTTP responses of 400 or higher fail the step |
| `click` | `target` | Clicks one resolved element |
| `fill` | `target`, exactly one of `value` / `valueFromEnv` | Replaces an input value |
| `select` | `target`, `value` | Selects one option value |
| `check` / `uncheck` | `target` | Sets checkbox state |
| `press` | `target`, `key` | Sends a Playwright key such as `Enter` |
| `waitFor` | `target` | Waits until the target is visible |
| `assertVisible` | `target` | Requires the target to be visible |
| `assertText` | `text`, optional `exact`, optional `target` | Waits for exactly one visible matching text node, optionally inside one visible target |
| `assertUrl` | `pattern` | Waits for a URL match until `timeoutMs`; `*` is a wildcard |

Every step requires a unique slug in `id`.

`assertText` searches the page when `target` is omitted. With `target`, it searches that single visible container's descendants. Hidden matches do not count. Multiple visible matches fail as ambiguous. `exact` defaults to `false` for asserted text: `false` permits a substring; `true` requires the whole element text. Target selector `exact` still defaults to `true`. Use a scope such as `{ "testId": "checkout-confirmation" }` when the same text appears in several components.

`assertUrl` matches a complete URL. An absolute pattern stays absolute even with `--base-url`; a root-relative pattern such as `/welcome` uses the effective base URL's origin. Other relative strings retain the v1 complete-URL matching behavior. A `goto` path resolves against the effective base URL and cannot leave its origin.

Unknown fields, invalid optional field types, duplicate step IDs, and ambiguous selectors are rejected. The published MCP JSON Schema covers the structural contract; the runtime additionally checks URL parsing and uniqueness across step IDs, which standard per-item schema rules cannot express here.

## Secrets

Prefer environment variables:

```json
{
  "id": "password",
  "action": "fill",
  "target": { "label": "Password" },
  "valueFromEnv": "STAGING_PASSWORD",
  "sensitive": true
}
```

`sensitive: true` redacts a literal value from `report.json`. `valueFromEnv` values are never serialized. Because a later screenshot could still contain the filled field, add the same field to `evidence.mask`.

## Evidence

```json
{
  "evidence": {
    "screenshots": "on-failure",
    "trace": true,
    "mask": [{ "label": "Password" }]
  }
}
```

Screenshot modes are `always`, `on-failure`, and `off`. Trace defaults to enabled. Evidence is written locally under `.flowcheck/runs/` unless `--output` overrides the directory.

Masks affect screenshots only. Traces, URLs, network traffic, and diagnostic messages can contain sensitive data. Inspect artifacts before uploading them. The CLI does not upload evidence automatically.

## Suites and reports

`flowcheck run` accepts one file, a directory of `.json` files, or a quoted glob. Suite files run sequentially in lexical path order, each in a fresh browser context. A failed assertion does not stop later files; an invalid file is recorded as `errored` and later files still run. If the browser or artifact storage fails, remaining files are `skipped`. Empty matches return exit code `2`.

`--base-url` changes the effective target for this run without editing source JSON. The actual URL and both source and executed scenario digests are saved in each report. A single-file run retains the single-report CLI JSON shape. A suite writes `suite.json` and an aggregate `junit.xml` alongside per-scenario reports. Report `schemaVersion` is `2`: steps can be `passed`, `failed`, `errored`, or `skipped`, and a run can be `passed`, `failed`, or `errored`. The scenario DSL remains version `1`.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Scenario passed |
| `1` | A browser step or assertion failed |
| `2` | Invalid input, invalid scenario, or infrastructure error |
