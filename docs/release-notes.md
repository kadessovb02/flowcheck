FlowCheck is packaged as `@kadessovb/flowcheck` under the maintainer-owned npm organization.

After npm publication, run without cloning, building, or adding project dependencies:

```bash
npx --yes @kadessovb/flowcheck demo
npx --yes @kadessovb/flowcheck check http://localhost:3000
```

From the project you want to test, connect your installed coding agent:

```bash
npx --yes @kadessovb/flowcheck connect codex
# or
npx --yes @kadessovb/flowcheck connect claude
```

MCP registration pins this package version. Chromium downloads on first use and is reused on subsequent runs. Standalone checks work without an AI agent, account, or API key.

Requires Node.js 22.18+ on macOS or Linux. On minimal Linux installations, `setup --with-deps` installs required system libraries and may require administrator privileges.

The archive is built and tested from this tag in GitHub Actions. `SHA256SUMS` contains its checksum. npm publication is a separate maintainer step; the release archive can also be run directly:

```bash
npx --yes https://github.com/kadessovb02/flowcheck/releases/download/v0.2.1/flowcheck.tgz demo
```

This is an early developer preview. Screenshot masks do not redact traces, URLs, or error messages; keep test evidence private.
