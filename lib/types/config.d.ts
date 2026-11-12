/**
 * Plugin configuration: where to look for a project file and how the runtime behaves.
 *
 * The servers themselves live in the project file, never here, so switching a
 * profile or a preset never has to describe a project's MCP surface.
 */
import z from '@deepseek-ai/schemastery';
export interface Config {
    /** Master switch. When false no project file is read. */
    enabled: boolean;
    /** Candidate project-relative paths, tried in this order at every ancestor; `.mcp.json` is the Claude Code dialect. */
    fileNames: string[];
    /** Reload mounted servers when the file changes, appears, or disappears. */
    watch: boolean;
    /** Coalescing window for filesystem events, in milliseconds. */
    watchDebounceMs: number;
    /** Upper bound on how long one Session waits for its servers when it is created. */
    startupTimeoutMs: number;
    /** Upper bound on servers mounted per Session. */
    maxServers: number;
    /** Mount project servers in subagent Sessions too; disabling halves process count on fan-out. */
    includeSubagents: boolean;
}
/** Schema exposed to the Cordis loader as `Config`. */
export declare const PluginConfig: z<Config>;
/** Validate loader input once, so the runtime never re-reads raw configuration. */
export declare function resolveConfig(raw: Partial<Config> | undefined): Config;
