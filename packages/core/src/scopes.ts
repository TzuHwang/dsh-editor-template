/**
 * Scope strategies: which key editor view state is stored under.
 *
 * `session` (default): each session keeps its own view state.
 * `workspace`: every session in one workspace shares it. A project may register its own
 * strategy (e.g. per git branch) and select it by id.
 */

export interface ScopeEnv {
  /** Workspace root of the session on screen; undefined when the session has none yet. */
  readonly workspaceRoot: string | undefined
  readonly sessionId: string | undefined
}

export interface EditorScopeStrategy {
  readonly id: string
  /** The storage key for this environment, or null when there is no scope (empty editor). */
  resolveKey(env: ScopeEnv): string | null
}

export const workspaceScope: EditorScopeStrategy = {
  id: 'workspace',
  resolveKey: env => env.workspaceRoot === undefined ? null : `workspace:${env.workspaceRoot}`,
}

export const sessionScope: EditorScopeStrategy = {
  id: 'session',
  resolveKey: env => env.sessionId === undefined ? null : `session:${env.sessionId}`,
}

export class ScopeRegistry {
  private readonly strategies = new Map<string, EditorScopeStrategy>()

  register(strategy: EditorScopeStrategy): () => void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`dsh-editor: scope strategy "${strategy.id}" is already registered`)
    }
    this.strategies.set(strategy.id, strategy)
    return () => {
      if (this.strategies.get(strategy.id) === strategy) this.strategies.delete(strategy.id)
    }
  }

  /** Registered strategy ids, in registration order. */
  ids(): string[] {
    return [...this.strategies.keys()]
  }

  /** The strategy for an id; an unknown id falls back to `session` (the default) so a stale setting never blanks the editor. */
  get(id: string): EditorScopeStrategy {
    return this.strategies.get(id) ?? this.strategies.get(sessionScope.id) ?? sessionScope
  }
}
