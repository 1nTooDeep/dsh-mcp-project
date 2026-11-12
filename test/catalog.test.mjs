/**
 * Unit tests for project-file discovery and normalization. They run against the
 * built lib/ output, so they also prove the compiled module graph loads.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findProjectMcpFile, readProjectMcpDocument } from '../lib/catalog.js'
import { expandEnv } from '../lib/env.js'

const FILES = ['.dsh/mcp.yml', '.mcp.json']

async function project(files) {
  const root = await mkdtemp(join(tmpdir(), 'mcp-project-'))
  await mkdir(join(root, '.dsh'), { recursive: true })
  await mkdir(join(root, 'packages', 'inner', 'src'), { recursive: true })
  if (files !== undefined) await writeFile(join(root, '.dsh', 'mcp.yml'), files)
  return root
}

async function jsonProject(body) {
  const root = await mkdtemp(join(tmpdir(), 'mcp-json-'))
  await writeFile(join(root, '.mcp.json'), body)
  return root
}

test('expandEnv resolves values, applies fallbacks, and rejects missing names', () => {
  assert.equal(expandEnv('${A}/x', { A: 'one' }), 'one/x')
  assert.equal(expandEnv('${A:-fallback}', {}), 'fallback')
  assert.equal(expandEnv('$${A}', { A: 'one' }), '${A}')
  assert.throws(() => expandEnv('${MISSING}', {}), /MISSING/)
})

test('findProjectMcpFile prefers the nearest ancestor', async () => {
  const root = await project('servers: {}\n')
  await mkdir(join(root, 'packages', 'inner', '.dsh'), { recursive: true })
  await writeFile(join(root, 'packages', 'inner', '.dsh', 'mcp.yml'), 'servers: {}\n')
  const match = await findProjectMcpFile(join(root, 'packages', 'inner', 'src'), FILES)
  assert.equal(match.file, join(root, 'packages', 'inner', '.dsh', 'mcp.yml'))
  assert.equal(match.projectDir, join(root, 'packages', 'inner'))
})

test('a project without the file reports nothing', async () => {
  const root = await project(undefined)
  assert.equal(await findProjectMcpFile(root, FILES), undefined)
})

test('servers are normalized: defaults, cwd anchoring, env expansion, disabled entries', async () => {
  const root = await project(`
servers:
  local:
    command: node
    args: ["server.mjs", "\${PROBE_ARG:-arg}" ]
    env:
      TOKEN: "\${PROBE_TOKEN}"
    cwd: sub
  remote:
    transport: streamable-http
    url: "https://example.invalid/mcp"
  off:
    enabled: false
    command: node
`)
  const previous = process.env.PROBE_TOKEN
  process.env.PROBE_TOKEN = 'secret'
  const match = await findProjectMcpFile(root, FILES)
  try {
    const document = await readProjectMcpDocument(match, { maxServers: 8 })
    assert.equal(document.servers.length, 2)
    assert.deepEqual(document.warnings, ['server "off" is disabled'])
    const [local, remote] = document.servers
    assert.equal(local.name, 'local')
    assert.equal(local.config.serverName, 'local')
    assert.equal(local.config.transport, 'stdio')
    assert.equal(local.config.cwd, join(root, 'sub'))
    assert.deepEqual(local.config.args, ['server.mjs', 'arg'])
    assert.deepEqual(local.config.env, { TOKEN: 'secret' })
    assert.equal(remote.name, 'remote')
    assert.equal(remote.config.serverName, 'remote')
    assert.equal(remote.config.transport, 'streamable-http')
  } finally {
    if (previous === undefined) delete process.env.PROBE_TOKEN
    else process.env.PROBE_TOKEN = previous
  }
})

test('an unusable entry is a warning, not a file-wide failure', async () => {
  const root = await project('servers:\n  broken:\n    args: []\n  fine:\n    command: node\n')
  const match = await findProjectMcpFile(root, FILES)
  const document = await readProjectMcpDocument(match, { maxServers: 8 })
  assert.deepEqual(
    document.servers.map((server) => server.name),
    ['fine'],
  )
  assert.match(document.warnings[0], /server "broken" skipped: .*need a "command"/)
})

test('Claude Code .mcp.json is read: mcpServers, type alias, unsupported transport skipped', async () => {
  const root = await jsonProject(
    JSON.stringify({
      mcpServers: {
        // a comment line is tolerated
        local: {
          type: 'stdio',
          command: '/usr/bin/bash',
          args: ['-c', 'cd backend && exec node server.mjs'],
          env: { TOKEN: '${PROBE_TOKEN:-none}' },
        },
        remote: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer x' } },
        legacy: { type: 'sse', url: 'https://example.invalid/sse' },
      },
    }),
  )
  const match = await findProjectMcpFile(root, FILES)
  assert.equal(match.file, join(root, '.mcp.json'))
  const document = await readProjectMcpDocument(match, { maxServers: 8 })
  assert.deepEqual(
    document.servers.map((server) => server.name),
    ['local', 'remote'],
  )
  const [local, remote] = document.servers
  assert.equal(local.config.transport, 'stdio')
  assert.equal(local.config.cwd, root)
  assert.equal(local.config.type, undefined)
  assert.deepEqual(local.config.env, { TOKEN: 'none' })
  assert.equal(remote.config.transport, 'streamable-http')
  assert.match(document.warnings[0], /server "legacy" skipped: .*sse.*not supported/)
})

test('the DSH file wins over .mcp.json at the same level', async () => {
  const root = await project('servers:\n  from-yml:\n    command: node\n')
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'from-json': { command: 'node' } } }))
  const match = await findProjectMcpFile(root, FILES)
  assert.equal(match.file, join(root, '.dsh', 'mcp.yml'))
})
