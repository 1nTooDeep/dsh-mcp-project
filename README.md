# dsh-mcp-project

Per-project MCP servers for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
A repository declares its own MCP servers in `.dsh/mcp.yml` — or reuses an existing
Claude Code `.mcp.json` — and every DSH Session working inside that repository loads
them automatically. Nothing needs to be added to the DSH profile per project.

```text
<repo>/.dsh/mcp.yml  ──▶  mounted into every Session whose cwd is inside <repo>
                          tools: mcp__<server>__<tool>
```

## Why

DSH's `@deepseek-ai/dsh-mcp-client` binds **one MCP server per Cordis plugin instance**,
and those instances live in a profile composition (`cordis.patch.yml`). Everything
opened in one profile therefore shares one MCP surface: a database tool written for
one project shows up in every other project too, and its tool schemas are paid for
in every request.

This plugin adds the missing project layer:

- MCP servers are declared by the project, next to the code they serve, and can be
  reviewed and versioned with it.
- Tools are registered in the **Session's agent scope**, so they are visible only to
  Sessions working in that project.
- Editing the declaration remounts the servers without restarting DSH.

## Install

**From GitHub** (no build step — `lib/` ships in the repository):

```bash
# In DSH: Plugins page → install a bundle, or through the plugin manager tool:
#   install_bundle  github:1nTooDeep/dsh-mcp-project
```

Equivalent manual step in the profile's `package.json`:

```json
{
  "dependencies": { "dsh-mcp-project": "github:1nTooDeep/dsh-mcp-project" },
  "dsh": { "profile": { "bundles": ["…", "dsh-mcp-project"] } }
}
```

Then restart DSH (or reload the bundle from the Plugins page).

**From a plugin index**: add this URL in **Plugins → Discover → add source**, then
install from the list:

```text
https://raw.githubusercontent.com/1nTooDeep/dsh-mcp-project/main/market-index.json
```

**For development**, link a checkout instead of installing:

```bash
# profile package.json
"dsh-mcp-project": "link:/path/to/dsh-mcp-project"
```

## Declaring servers

### DSH dialect — `.dsh/mcp.yml`

```yaml
servers:
  # stdio server: a child process
  project-db:
    command: /usr/local/bin/db-mcp-server
    args: []
    env:
      DB_SECRET_FILE: ${DB_SECRET_FILE}
    cwd: .                      # relative to the project root; default is the project root
    toolCallTimeoutMs: 60000

  # Streamable HTTP server: a URL
  docs:
    transport: streamable-http
    url: https://mcp.example.com/mcp
    headers:
      Authorization: Bearer ${DOCS_MCP_TOKEN}

  # Disabled without deleting it
  legacy:
    enabled: false
    command: node
    args: [legacy-server.mjs]
```

### Claude Code dialect — `.mcp.json`

A repository that already publishes `.mcp.json` needs no second file:

```json
{
  "mcpServers": {
    "project-db": {
      "type": "stdio",
      "command": "/usr/bin/bash",
      "args": ["-c", "cd backend && exec ./run-mcp-server"],
      "env": { "DEV": "true" }
    }
  }
}
```

`type` is mapped to the transport DSH speaks: `stdio` → stdio, `http` → streamable
HTTP. An entry asking for `sse` is skipped with a warning, because the DSH MCP bridge
has no SSE transport.

### Shared rules

- Keys under `servers:` / `mcpServers:` are the namespace: the model sees
  `mcp__<name>__<tool>`. Names must match `[A-Za-z0-9_-]{1,32}`.
- `transport` defaults to `stdio`; `stdio` needs `command`, `streamable-http` needs
  `url`.
- `${VAR}` and `${VAR:-fallback}` are expanded in every string value from the
  environment of the DSH host process. Use them for secrets — never commit a token.
  `$${` escapes a literal `${`. Both dialects expand.
- `enabled: false` keeps an entry documented but unmounted.
- Every other field is passed to `mcp-client` unchanged (`args`, `env`,
  `toolCallTimeoutMs`, `maxInstructionBytes`, `reconnect`, `headers`, …).

## Which file wins

Discovery starts at the Session's **effective working directory** and walks to the
filesystem root. At each ancestor the candidates are tried in this order:

1. `.dsh/mcp.yml`
2. `.dsh/mcp.yaml`
3. `.mcp.json`

The first match wins, so a DSH-specific file overrides the Claude Code one at the same
level, and the nearest ancestor overrides anything further up. A package inside a
monorepo can therefore carry its own MCP surface without touching the repository root.

## Scope and process cost

- One generation per Session (Agent scope). Two Sessions in the same project each
  spawn their own server processes; a subagent gets its own copy unless
  `includeSubagents: false` is set. A host with N live Sessions in one project runs N
  processes per declared server — bound it with `maxServers`.
- Namespace collisions with profile-level servers are safe: scoped tools shadow global
  ones, so a project can replace the MCP surface the profile defines under the same
  name. The profile's own process keeps running; the project's tools win.
- A project cannot *disable* a profile-level server, only shadow its names.

## Reloading

With `watch: true` (default), editing, creating, or deleting the file remounts that
Session's servers after a short debounce, and moving the Session's working directory
re-resolves which file applies. Removing a server disposes its process and unregisters
its tools.

## Failure behaviour

A broken file, an invalid entry, or a server that never starts never fails the
Session. The plugin logs the reason (prefix `mcp-project:`), mounts what it can, and
leaves the remaining tools available. A server slower than `startupTimeoutMs` still
finishes mounting in the background and publishes its tools when ready.

## Plugin configuration

```yaml
- id: mcp-project
  name: "dsh-mcp-project"
  config:
    enabled: true
    fileNames: [".dsh/mcp.yml", ".dsh/mcp.yaml", ".mcp.json"]
    watch: true
    watchDebounceMs: 250
    startupTimeoutMs: 5000
    maxServers: 16
    includeSubagents: true      # false = top-level Sessions only (fewer server processes)
```

## Security

The declaration names commands that the DSH host executes with **your** privileges, so
treat it like a shell script: only trust project files you would run yourself. Do not
open a checkout from an untrusted source with this plugin enabled — `enabled: false`
turns the whole feature off.

## Market / discovery

DSH has no central plugin registry: the **Discover** tab lists exactly the index
sources the user adds. This repository therefore ships
[`market-index.json`](market-index.json) in the
[plugin index format 1](https://github.com/deepseek-ai/deepseek-harness), so it can be
added as a source directly:

```text
https://raw.githubusercontent.com/1nTooDeep/dsh-mcp-project/main/market-index.json
```

Each entry pins a git commit, so an install from the index is reproducible. Once the
package is also published to npm, an index entry can switch its `source` to
`{"type": "npm"}` and drop the commit pin.

## Development

`lib/` is committed so that `github:` installs work without a build step. After
changing `src/`, rebuild and commit `lib/` as well.

```bash
bash scripts/build.sh        # links the DSH runtime's node_modules, then runs tsc
node --test test/*.test.mjs  # 7 unit tests over the built lib/
```

Layout:

- `src/index.ts` — plugin entry (`apply`, `Config`, `name`, `inject`)
- `src/config.ts` — plugin knobs and their defaults
- `src/catalog.ts` — discovery, both dialects, per-server normalization
- `src/env.ts` — `${VAR}` expansion
- `src/runtime.ts` — per-Agent mounting, watchers, reload
- `test/` — unit tests plus a dependency-free `probe` MCP server fixture

## License

MIT. See [LICENSE](LICENSE).
