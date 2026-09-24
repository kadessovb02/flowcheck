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
| `goto` | `path` | Opens a URL relative to `baseUrl` |
| `click` | `target` | Clicks one resolved element |
| `fill` | `target`, exactly one of `value` / `valueFromEnv` | Replaces an input value |
| `select` | `target`, `value` | Selects one option value |
| `check` / `uncheck` | `target` | Sets checkbox state |
| `press` | `target`, `key` | Sends a Playwright key such as `Enter` |
| `waitFor` | `target` | Waits until the target is visible |
| `assertVisible` | `target` | Requires the target to be visible |
| `assertText` | `text`, optional `exact` | Requires visible page text |
| `assertUrl` | `pattern` | Matches the complete URL; `*` is a wildcard |

Every step requires a unique slug in `id`.

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

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Scenario passed |
| `1` | A browser step or assertion failed |
| `2` | Invalid input, invalid scenario, or runtime setup error |
