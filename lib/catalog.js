/**
 * Project file discovery, parsing, and per-server normalization.
 *
 * Two dialects are read: DSH's own `.dsh/mcp.yml` (a `servers:` mapping) and the
 * Claude Code shared `.mcp.json` (`{"mcpServers": {...}}` with `type` instead of
 * `transport`). The JSON dialect is read so a repository that already declares
 * its MCP servers for other agents does not need a second copy.
 *
 * Discovery walks from the Session's working directory toward the filesystem
 * root and takes the nearest match, so a package inside a monorepo can carry its
 * own MCP surface without touching the repository root. One bad entry is a
 * warning, not a failure: a shared JSON file often mixes transports this bridge
 * cannot serve. Nothing here touches an Agent or a running server, which keeps
 * the failure boundary narrow.
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { expandEnv } from './env.js';
/** `mcp-client` publishes tool names as `mcp__<serverName>__<tool>`, so this is its namespace contract. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** Keys that hold the server mapping, in DSH-first order. */
const SERVER_MAP_KEYS = ['servers', 'mcpServers'];
/** Accepted `type`/`transport` values; `http` is the Claude Code spelling of streamable HTTP. */
const TRANSPORT_ALIASES = {
    stdio: 'stdio',
    http: 'streamable-http',
    'streamable-http': 'streamable-http',
};
/** Nearest ancestor (inclusive) that carries one of `fileNames`. */
export async function findProjectMcpFile(cwd, fileNames) {
    let current = resolve(cwd);
    for (;;) {
        for (const name of fileNames) {
            const candidate = join(current, name);
            if (await isFile(candidate))
                return { file: candidate, projectDir: current };
        }
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
/** Read, validate and normalize one project file. Throws only on file-wide problems. */
export async function readProjectMcpDocument(match, options) {
    let text;
    try {
        text = await readFile(match.file, 'utf8');
    }
    catch (error) {
        throw new Error(`${match.file}: cannot be read (${errorText(error)})`);
    }
    let document;
    try {
        document = match.file.endsWith('.json') ? JSON.parse(stripJsonComments(text)) : parse(text);
    }
    catch (error) {
        throw new Error(`${match.file}: invalid ${match.file.endsWith('.json') ? 'JSON' : 'YAML'} (${errorText(error)})`);
    }
    if (document === null || document === undefined) {
        return { file: match.file, projectDir: match.projectDir, servers: [], warnings: [] };
    }
    if (typeof document !== 'object' || Array.isArray(document)) {
        throw new Error(`${match.file}: expected a mapping with a "servers" key`);
    }
    const record = document;
    const mapKey = SERVER_MAP_KEYS.find((key) => key in record);
    const rawServers = mapKey === undefined ? omitMeta(record) : record[mapKey];
    if (rawServers === undefined || rawServers === null) {
        return { file: match.file, projectDir: match.projectDir, servers: [], warnings: [] };
    }
    if (typeof rawServers !== 'object' || Array.isArray(rawServers)) {
        throw new Error(`${match.file}: ${mapKey ?? 'the file'} must map server names to configurations`);
    }
    const warnings = [];
    const servers = [];
    for (const [rawName, rawValue] of Object.entries(rawServers)) {
        const name = rawName.trim();
        if (!SERVER_NAME_PATTERN.test(name)) {
            throw new Error(`${match.file}: server name "${rawName}" must match [A-Za-z0-9_-]{1,32}`);
        }
        if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
            throw new Error(`${match.file}: server "${name}" must be a mapping of its settings`);
        }
        const entry = rawValue;
        if (entry.enabled === false) {
            warnings.push(`server "${name}" is disabled`);
            continue;
        }
        if (servers.length >= options.maxServers) {
            warnings.push(`server "${name}" skipped: maxServers is ${options.maxServers}`);
            continue;
        }
        try {
            servers.push({ name, config: normalizeServer(match, name, entry) });
        }
        catch (error) {
            // One unusable entry must not hide the rest of a shared project file.
            warnings.push(`server "${name}" skipped: ${errorText(error)}`);
        }
    }
    return { file: match.file, projectDir: match.projectDir, servers, warnings };
}
/** Expand environment references, validate the fields that decide a transport, and anchor `cwd`. */
function normalizeServer(match, name, entry) {
    let expanded;
    try {
        expanded = expandStrings(omitMeta(entry));
    }
    catch (error) {
        throw new Error(`${match.file}: server "${name}": ${errorText(error)}`);
    }
    // The YAML key is the namespace: `mcp-client` publishes `mcp__<serverName>__<tool>`
    // and reserves one serverName per Agent scope.
    const declared = expanded.transport ?? expanded.type ?? 'stdio';
    const transport = typeof declared === 'string' ? TRANSPORT_ALIASES[declared] : undefined;
    if (transport === undefined) {
        throw new Error(`${match.file}: server "${name}": transport "${String(declared)}" is not supported (use stdio or streamable-http)`);
    }
    if (transport === 'stdio') {
        if (typeof expanded.command !== 'string' || expanded.command.trim() === '') {
            throw new Error(`${match.file}: server "${name}": stdio servers need a "command"`);
        }
        const cwd = typeof expanded.cwd === 'string' ? expanded.cwd.trim() : '';
        return { ...withoutType(expanded), serverName: name, transport, cwd: cwd === '' ? match.projectDir : resolve(match.projectDir, cwd) };
    }
    if (typeof expanded.url !== 'string' || expanded.url.trim() === '') {
        throw new Error(`${match.file}: server "${name}": streamable-http servers need a "url"`);
    }
    return { ...withoutType(expanded), serverName: name, transport };
}
/** Recursively expand every string leaf; keys are never expanded. */
function expandStrings(value) {
    if (typeof value === 'string')
        return expandEnv(value);
    if (Array.isArray(value))
        return value.map((item) => expandStrings(item));
    if (value !== null && typeof value === 'object') {
        const result = {};
        for (const [key, child] of Object.entries(value))
            result[key] = expandStrings(child);
        return result;
    }
    return value;
}
/** Drop the plugin-owned `enabled` switch and the server-map labels. */
function omitMeta(entry) {
    const result = {};
    for (const [key, value] of Object.entries(entry)) {
        if (key === 'enabled' || SERVER_MAP_KEYS.includes(key))
            continue;
        result[key] = value;
    }
    return result;
}
/** Drop the Claude Code `type` alias once it has been mapped to `transport`. */
function withoutType(entry) {
    const { type: _type, ...rest } = entry;
    return rest;
}
/** JSON does not carry comments; a stray `//` line in a shared `.mcp.json` is common enough to tolerate. */
function stripJsonComments(text) {
    return text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=catalog.js.map