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
import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';
import { findProjectMcpFile, readProjectMcpDocument } from './catalog.js';
/** Mounts, reloads and unmounts project MCP servers per Session. */
export class ProjectMcpRuntime {
    ctx;
    config;
    states = new Map();
    watchers = new Map();
    closed = false;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    /** Subscribe to Agent lifecycle and seed the Agents that were already live at activation. */
    start() {
        this.ctx.on('agent/created', ({ agent }) => this.attach(agent).then(() => undefined));
        this.ctx.on('agent/disposed', ({ agent }) => {
            void this.forget(agent.id);
        });
        this.ctx.on('session/event', (session, event) => {
            if (event.type !== 'working-directory/change')
                return;
            const state = this.states.get(session.id);
            if (state !== undefined)
                this.schedule(state);
        });
        for (const agent of this.ctx.agents.list())
            this.schedule(this.stateFor(agent), true);
    }
    /** Stop every watcher and dispose every generation. */
    async dispose() {
        this.closed = true;
        for (const entry of this.watchers.values())
            entry.watcher.close();
        this.watchers.clear();
        await Promise.all([...this.states.keys()].map((id) => this.forget(id)));
    }
    /** Mount for a newly created Agent, bounded so creation never waits on a slow server. */
    attach(agent) {
        const mounted = this.refresh(this.stateFor(agent), true);
        if (this.config.startupTimeoutMs <= 0)
            return mounted;
        return Promise.race([mounted, delay(this.config.startupTimeoutMs)]);
    }
    stateFor(agent) {
        let state = this.states.get(agent.id);
        if (state === undefined) {
            state = { agent, fibers: [], queue: Promise.resolve() };
            this.states.set(agent.id, state);
        }
        return state;
    }
    /** Queue one refresh; the returned promise never rejects. */
    refresh(state, force = false) {
        const next = state.queue
            .then(() => this.apply(state, force))
            .catch((error) => {
            this.warn(`session ${String(state.agent.id)}: ${errorText(error)}`);
        });
        state.queue = next;
        return next;
    }
    /** Debounce a refresh triggered by a watcher or a working-directory change. */
    schedule(state, force = false) {
        if (this.closed)
            return;
        state.pendingForce = state.pendingForce === true || force;
        if (state.timer !== undefined)
            clearTimeout(state.timer);
        const timer = setTimeout(() => {
            state.timer = undefined;
            const forced = state.pendingForce === true;
            state.pendingForce = false;
            void this.refresh(state, forced);
        }, this.config.watchDebounceMs);
        timer.unref();
        state.timer = timer;
    }
    /** Resolve the project file for this Agent and reconcile the mounted generation with it. */
    async apply(state, force) {
        if (this.closed)
            return;
        if (!this.config.includeSubagents && state.agent.session.header.origin === 'subagent') {
            await this.teardown(state);
            return;
        }
        const cwd = this.cwdOf(state.agent);
        const match = cwd === undefined ? undefined : await findProjectMcpFile(cwd, this.config.fileNames);
        // A watcher event force-remounts even when the path is unchanged, because the
        // content may have changed; a failed generation retries on the next event.
        if (!force && match !== undefined && match.file === state.file && state.fibers.length > 0 && state.failed !== true)
            return;
        await this.teardown(state);
        if (match === undefined) {
            // A project may gain its first file mid-Session; watch the working directory
            // itself, which sees `.dsh` appear, instead of a directory that does not exist.
            if (cwd !== undefined && this.config.watch)
                this.retain(cwd, state.agent.id, false);
            return;
        }
        if (this.config.watch)
            this.retain(dirname(match.file), state.agent.id, true);
        state.dir = dirname(match.file);
        let document;
        try {
            document = await readProjectMcpDocument(match, { maxServers: this.config.maxServers });
        }
        catch (error) {
            this.warn(`session ${String(state.agent.id)}: ${errorText(error)}`);
            return;
        }
        for (const warning of document.warnings)
            this.warn(`${match.file}: ${warning}`);
        state.file = match.file;
        state.failed = false;
        for (const server of document.servers) {
            const fiber = this.mount(state, server);
            if (fiber !== undefined)
                state.fibers.push(fiber);
        }
        if (document.servers.length === 0)
            return;
        this.info(`session ${String(state.agent.id)}: ${document.servers.length} project MCP server(s) from ${match.file}: ${document.servers
            .map((server) => server.name)
            .join(', ')}`);
        await Promise.all(state.fibers.map((fiber) => this.awaitFiber(fiber)));
    }
    /** Create one Agent-scoped `mcp-client` instance; startup failure stays inside this server. */
    mount(state, server) {
        let fiber;
        try {
            fiber = state.agent.ctx.plugin(McpClient, server.config);
        }
        catch (error) {
            this.warn(`server "${server.name}": ${errorText(error)}`);
            return undefined;
        }
        void Promise.resolve(fiber).catch((error) => {
            // A rejected activation leaves no tools behind: drop the dead fiber so the
            // generation count stays honest, and let the next event retry the mount.
            state.failed = true;
            const index = state.fibers.indexOf(fiber);
            if (index >= 0)
                state.fibers.splice(index, 1);
            this.warn(`server "${server.name}" failed to start: ${errorText(error)}`);
        });
        return fiber;
    }
    /** Wait for activation at most `startupTimeoutMs`; a later activation still publishes tools. */
    async awaitFiber(fiber) {
        if (this.config.startupTimeoutMs <= 0)
            return;
        const settled = Promise.resolve(fiber).then(() => undefined, () => undefined);
        await Promise.race([settled, delay(this.config.startupTimeoutMs)]);
    }
    /** Dispose the mounted generation and release its watcher reference. */
    async teardown(state) {
        if (state.dir !== undefined) {
            this.release(state.dir, state.agent.id);
            state.dir = undefined;
        }
        state.file = undefined;
        for (const fiber of state.fibers.splice(0)) {
            try {
                await fiber.dispose();
            }
            catch (error) {
                this.warn(`disposal failed: ${errorText(error)}`);
            }
        }
    }
    /** Drop one Agent's state and generation. */
    async forget(agentId) {
        const state = this.states.get(agentId);
        if (state === undefined)
            return;
        this.states.delete(agentId);
        if (state.timer !== undefined) {
            clearTimeout(state.timer);
            state.timer = undefined;
        }
        await this.teardown(state);
    }
    /** Share one directory watcher between the Agents that resolved a file inside it. */
    retain(dir, agentId, filterByName) {
        let entry = this.watchers.get(dir);
        if (entry === undefined) {
            let watcher;
            try {
                watcher = watch(dir, { persistent: false });
            }
            catch (error) {
                this.warn(`cannot watch ${dir}: ${errorText(error)}`);
                return;
            }
            const created = { watcher, agents: new Map() };
            watcher.on('change', (_event, filename) => {
                for (const [id, filtered] of created.agents) {
                    if (filtered && filename !== null && !this.config.fileNames.some((name) => basename(name) === filename))
                        continue;
                    const state = this.states.get(id);
                    if (state !== undefined)
                        this.schedule(state, true);
                }
            });
            watcher.on('error', (error) => this.warn(`watcher for ${dir} failed: ${errorText(error)}`));
            this.watchers.set(dir, created);
            entry = created;
        }
        entry.agents.set(agentId, filterByName);
    }
    release(dir, agentId) {
        const entry = this.watchers.get(dir);
        if (entry === undefined)
            return;
        entry.agents.delete(agentId);
        if (entry.agents.size > 0)
            return;
        entry.watcher.close();
        this.watchers.delete(dir);
    }
    /** The directory the Session actually operates in, not only where it was created. */
    cwdOf(agent) {
        try {
            const service = this.ctx.get('workingDirectory');
            if (service !== undefined)
                return service.get(agent.session);
        }
        catch {
            // Fall through to the immutable creation-time directory.
        }
        return agent.session.header.cwd;
    }
    info(message) {
        this.ctx.logger.info(`mcp-project: ${message}`);
    }
    warn(message) {
        this.ctx.logger.warn(`mcp-project: ${message}`);
    }
}
function delay(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref();
    });
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=runtime.js.map