/**
 * @dsh-external/dsh-mcp-project — per-project MCP servers for DSH.
 *
 * Why this plugin exists: `@deepseek-ai/dsh-mcp-client` binds one MCP server per
 * Cordis plugin instance, and those instances live in a profile composition, so
 * every project opened in a profile shares one MCP surface. This plugin reads
 * `<project>/.dsh/mcp.yml` (or a Claude Code `.mcp.json`) from the nearest
 * ancestor of a Session's working directory and mounts one `mcp-client` instance
 * per declared server inside that Agent's scope. A project therefore carries its
 * own MCP servers, the tools stay visible only to its Sessions, and no profile
 * edit is needed per project.
 *
 * @module @dsh-external/dsh-mcp-project
 */
import type { Context } from '@deepseek-ai/cordis';
import { PluginConfig, type Config as PluginConfigShape } from './config.js';
export { PluginConfig as Config };
export type ConfigShape = PluginConfigShape;
export declare const name = "mcp-project";
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig?: Partial<PluginConfigShape>): void;
