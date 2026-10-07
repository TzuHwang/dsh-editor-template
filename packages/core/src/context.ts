/**
 * What the user is looking at in the editor, per session (design Q6).
 *
 * Mounts write it; @dsh-editor/context reads it, mirrors it to the host for
 * the model, and draws the removable chip. Only the path, cursor and a bounded
 * selection travel: the model reads the file with its own tools if it needs more.
 */

/** A selection is cut to this many characters before it reaches the model. */
export const MAX_SELECTION_CHARS = 2000

/** What an engine reports about its cursor and selection. Lines are 1-based. */
export interface SelectionInfo {
  readonly cursorLine: number
  readonly fromLine: number
  readonly toLine: number
  /** Selected text; empty for a bare cursor. */
  readonly text: string
}

export interface EditorContext {
  /** Path as the session sees it (workspace-relative for session addresses). */
  readonly path: string
  readonly cursorLine: number
  readonly selection?: {
    readonly fromLine: number
    readonly toLine: number
    readonly text: string
    /** The text was cut to {@link MAX_SELECTION_CHARS}. */
    readonly truncated: boolean
  }
}

export function toEditorContext(path: string, info: SelectionInfo): EditorContext {
  if (info.text === '') return { path, cursorLine: info.cursorLine }
  const truncated = info.text.length > MAX_SELECTION_CHARS
  return {
    path,
    cursorLine: info.cursorLine,
    selection: {
      fromLine: info.fromLine,
      toLine: info.toLine,
      text: truncated ? info.text.slice(0, MAX_SELECTION_CHARS) : info.text,
      truncated,
    },
  }
}

/** Identity of a context: two equal keys say the same thing to the model. */
export function contextKey(context: EditorContext): string {
  return JSON.stringify([context.path, context.cursorLine, context.selection ?? null])
}

export interface SessionContextState {
  /** What the editor shows; undefined when no editor is open for the session. */
  readonly context: EditorContext | undefined
  /** The user removed the chip; cleared when the context changes. */
  readonly suppressed: boolean
}

export type ContextSnapshot = Readonly<Record<string, SessionContextState>>

/** The context the model should get for a session, after the user's ✕. */
export function effectiveContext(state: SessionContextState | undefined): EditorContext | undefined {
  return state === undefined || state.suppressed ? undefined : state.context
}

/**
 * Per-session editor context, with an owner per session: several editor views
 * may show files of one session and the last one the user worked in wins.
 * Observable with stable snapshots (`getSnapshot` / `subscribe`).
 */
export class ContextStore {
  private snapshot: ContextSnapshot = {}
  private readonly owners = new Map<string, object>()
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): ContextSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** `owner` (an editor view) now speaks for the session. */
  set(sessionId: string, owner: object, context: EditorContext): void {
    this.owners.set(sessionId, owner)
    const previous = this.snapshot[sessionId]
    if (previous?.context !== undefined && contextKey(previous.context) === contextKey(context)) return
    this.publish(sessionId, { context, suppressed: false })
  }

  /** The view closed; the session has no context unless another view takes over. */
  release(sessionId: string, owner: object): void {
    if (this.owners.get(sessionId) !== owner) return
    this.owners.delete(sessionId)
    this.publish(sessionId, undefined)
  }

  /** The user removed the chip for the current context. */
  suppress(sessionId: string): void {
    const state = this.snapshot[sessionId]
    if (state === undefined || state.suppressed) return
    this.publish(sessionId, { ...state, suppressed: true })
  }

  private publish(sessionId: string, state: SessionContextState | undefined): void {
    const next = { ...this.snapshot }
    if (state === undefined) delete next[sessionId]
    else next[sessionId] = state
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
