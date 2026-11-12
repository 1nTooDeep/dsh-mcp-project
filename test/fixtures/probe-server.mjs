#!/usr/bin/env node
/**
 * Minimal MCP stdio server used to verify that project MCP servers mount.
 * Dependency-free: newline-delimited JSON-RPC, one tool named `ping`.
 */

import { createInterface } from 'node:readline'

const SUPPORTED = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])
const TOOLS = [
  {
    name: 'ping',
    description: 'Reply with pong and the text that was sent.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back.' } },
      additionalProperties: false,
    },
  },
]

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = request
  if (id === undefined || id === null) return
  const reply = (result) => send({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        return reply({
          protocolVersion: SUPPORTED.has(requested) ? requested : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'probe', version: '0.0.1' },
        })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call':
        return reply({
          content: [{ type: 'text', text: `pong:${String(params?.arguments?.text ?? '')}` }],
        })
      default:
        return fail(-32601, `method not found: ${String(method)}`)
    }
  } catch (error) {
    return fail(-32603, String(error))
  }
})
