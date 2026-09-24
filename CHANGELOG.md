# Changelog

All notable changes will be documented here. This project follows semantic versioning once the first stable release is published.

## [0.2.0] - 2026-09-24

### Added

- Prebuilt release package runnable through npx without cloning or building.
- Automatic Chromium setup, explicit setup commands, and an offline opt-out.
- Standalone URL checks, optional text assertions, and JSON CLI output.
- Codex and Claude Code registration, generic MCP configuration, and inline MCP scenarios.
- A bundled demo using a free port, with evidence saved in the caller's project.
- Package smoke tests from a fresh npm cache and a tagged release workflow.

### Changed

- HTTP 4xx/5xx navigation responses fail the check.
- MCP workspace boundaries use canonical paths, including symlinked projects.
- The packaged command is `flowcheck`; start MCP with `flowcheck mcp`. The source MCP entry point remains available.

## Initial developer preview

### Added

- Versioned Scenario DSL v1 and strict validator.
- Deterministic Chromium runner with accessible locators.
- Screenshot masking, Playwright trace, JSON report, and JUnit evidence.
- CLI for initialization, validation, and execution.
- Local stdio MCP server for validation and execution.
- Real-browser quickstart and regression suite.
- Visible (`--headed`) and deliberately broken (`--broken`) quickstart modes.
- Quickstart regression tests for failure evidence, unchanged scenarios, and occupied ports.
- English and Russian onboarding with a real demo screenshot and tool comparison.
