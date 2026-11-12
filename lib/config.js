/**
 * Plugin configuration: where to look for a project file and how the runtime behaves.
 *
 * The servers themselves live in the project file, never here, so switching a
 * profile or a preset never has to describe a project's MCP surface.
 */
import z from '@deepseek-ai/schemastery';
/** Schema exposed to the Cordis loader as `Config`. */
export const PluginConfig = z.object({
    enabled: z.boolean().default(true),
    fileNames: z.array(String).default(['.dsh/mcp.yml', '.dsh/mcp.yaml', '.mcp.json']),
    watch: z.boolean().default(true),
    watchDebounceMs: z.number().step(1).min(50).default(250),
    startupTimeoutMs: z.number().step(1).min(0).default(5000),
    maxServers: z.number().step(1).min(1).default(16),
    includeSubagents: z.boolean().default(true),
});
/** Validate loader input once, so the runtime never re-reads raw configuration. */
export function resolveConfig(raw) {
    const config = PluginConfig(raw ?? {});
    if (config.fileNames.length === 0)
        throw new Error('mcp-project: fileNames must name at least one project file');
    return config;
}
//# sourceMappingURL=config.js.map