/**
 * `${VAR}` expansion for values that cannot live in a repository.
 *
 * Commands, arguments, directories, URLs, headers and child environment values
 * may reference the process environment, which is how a project file stays
 * shareable: the tunnel or API token stays in the shell that launched DSH.
 * `$${` escapes a literal `${` for commands that need one.
 */
/** Expand `${NAME}` and `${NAME:-fallback}`; a missing variable without a fallback throws. */
export declare function expandEnv(value: string, env?: NodeJS.ProcessEnv): string;
