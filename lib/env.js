/**
 * `${VAR}` expansion for values that cannot live in a repository.
 *
 * Commands, arguments, directories, URLs, headers and child environment values
 * may reference the process environment, which is how a project file stays
 * shareable: the tunnel or API token stays in the shell that launched DSH.
 * `$${` escapes a literal `${` for commands that need one.
 */
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const ESCAPED_REFERENCE = /\$\$\{/g;
const ESCAPE_MARK = '\u0000{';
/** Expand `${NAME}` and `${NAME:-fallback}`; a missing variable without a fallback throws. */
export function expandEnv(value, env = process.env) {
    const escaped = value.replace(ESCAPED_REFERENCE, ESCAPE_MARK);
    const expanded = escaped.replace(ENV_REFERENCE, (_match, name, fallback) => {
        const found = env[name];
        if (found !== undefined)
            return found;
        if (fallback !== undefined)
            return fallback;
        throw new Error(`environment variable "${name}" is not set`);
    });
    return expanded.split(ESCAPE_MARK).join('${');
}
//# sourceMappingURL=env.js.map