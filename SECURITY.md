# Security policy

## Supported versions

FlowCheck Local is currently a developer preview. Security fixes are applied to the latest commit on `main` and the latest tagged release.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. If that option is unavailable, contact the maintainer through the private contact listed on the owner's GitHub profile and request a secure channel.

Include the affected version, impact, minimal reproduction, and suggested mitigation when possible. Do not include real credentials, customer data, private target URLs, browser traces, or screenshots.

We aim to acknowledge a complete report within five business days. No bounty program is currently offered.

## Security boundaries

- The runner is a developer tool, not a sandbox for hostile scenario files.
- Only run scenarios from repositories and contributors you trust.
- FlowCheck blocks main-frame cross-origin navigation; it does not claim to be a complete network sandbox. A tested page can still load third-party subresources.
- Browser evidence can contain sensitive product data. Keep `.flowcheck/` out of source control and use explicit screenshot masks.
- Environment variables are inherited by the runner process. Use narrowly scoped credentials intended for testing.
- The MCP server limits scenario paths to its workspace root, but the MCP client remains responsible for user approval and process isolation.

## Release checklist

Maintainers must run unit tests, real-browser tests, type checking, dependency audit, and secret scanning before a release. Release artifacts must be built from a tagged commit through CI.
