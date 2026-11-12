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
/** One discovered file and the directory that contains it. */
export interface ProjectFileMatch {
    readonly file: string;
    readonly projectDir: string;
}
/** One server as the project file declared it, ready to hand to `mcp-client`. */
export interface ProjectServer {
    readonly name: string;
    readonly config: Readonly<Record<string, unknown>>;
}
/** A parsed project file. Servers that cannot be used are reported, not thrown. */
export interface ProjectMcpDocument {
    readonly file: string;
    readonly projectDir: string;
    readonly servers: readonly ProjectServer[];
    readonly warnings: readonly string[];
}
/** Nearest ancestor (inclusive) that carries one of `fileNames`. */
export declare function findProjectMcpFile(cwd: string, fileNames: readonly string[]): Promise<ProjectFileMatch | undefined>;
/** Read, validate and normalize one project file. Throws only on file-wide problems. */
export declare function readProjectMcpDocument(match: ProjectFileMatch, options: {
    maxServers: number;
}): Promise<ProjectMcpDocument>;
