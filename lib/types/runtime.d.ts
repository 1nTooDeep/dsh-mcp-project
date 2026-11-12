/**
 * Runtime: keep exactly one generation of project MCP servers mounted per live Agent.
 *
 * The Agent scope is the unit of ownership because `ctx.tools.register` inside an
 * Agent scope registers tools only that Session can see. Consequently a Session's
 * project is resolved from its effective working directory and re-resolved when
 * the working directory changes, the project file changes, or the file appears
 * for the first time.
 *
 * Failure containment rules, all deliberate:
 * - A broken file, a bad server entry, or a server that never starts must never
 *   fail `agent/created`; the Agent gets fewer tools, never a failed Session.
 * - Mounting waits at most `startupTimeoutMs` per Agent, so a slow server cannot
 *   stall a first turn; tools that arrive later still publish through
 *   `tools/change`.
 * - Teardown always precedes a new generation, so a reload cannot leave two
 *   generations of the same `serverName` alive in one Agent scope.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
/** Mounts, reloads and unmounts project MCP servers per Session. */
export declare class ProjectMcpRuntime {
    private readonly ctx;
    private readonly config;
    private readonly states;
    private readonly watchers;
    private closed;
    constructor(ctx: Context, config: Config);
    /** Subscribe to Agent lifecycle and seed the Agents that were already live at activation. */
    start(): void;
    /** Stop every watcher and dispose every generation. */
    dispose(): Promise<void>;
    /** Mount for a newly created Agent, bounded so creation never waits on a slow server. */
    private attach;
    private stateFor;
    /** Queue one refresh; the returned promise never rejects. */
    private refresh;
    /** Debounce a refresh triggered by a watcher or a working-directory change. */
    private schedule;
    /** Resolve the project file for this Agent and reconcile the mounted generation with it. */
    private apply;
    /** Create one Agent-scoped `mcp-client` instance; startup failure stays inside this server. */
    private mount;
    /** Wait for activation at most `startupTimeoutMs`; a later activation still publishes tools. */
    private awaitFiber;
    /** Dispose the mounted generation and release its watcher reference. */
    private teardown;
    /** Drop one Agent's state and generation. */
    private forget;
    /** Share one directory watcher between the Agents that resolved a file inside it. */
    private retain;
    private release;
    /** The directory the Session actually operates in, not only where it was created. */
    private cwdOf;
    private info;
    private warn;
}
