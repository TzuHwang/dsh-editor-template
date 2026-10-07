/**
 * The DSH surfaces this template touches, typed locally.
 *
 * DSH is a release candidate and its packages are not dependencies here, so
 * every DSH API we call is declared in this one file. On a DSH upgrade, this is
 * the file to audit (and the smoke test is what proves it). Verified against
 * @deepseek-ai/dsh 0.2.0-rc.2.
 */

/** Cordis context: only the members we use. */
export interface CordisContext {
  effect(factory: () => () => void, label?: string): () => void
  /** Optional service lookup (undefined when not provided). */
  get(name: string): unknown
  reflect: { provide(name: string, value: unknown): () => void }
  [service: string]: unknown
}

/** A Remote call never throws for business failures; it resolves to a Result. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly details?: unknown } }

/** `ctx.remote.workspaceFiles.readBytes` result. */
export interface WorkspaceFileBytes {
  readonly absolutePath: string
  readonly version: string
  readonly bytes?: number
  readonly offset: number
  readonly data: Uint8Array
  readonly eof: boolean
}

/** One frame of `ctx.remote.workspaceFiles.changes`. */
export type WorkspaceFileWatchFrame =
  | { readonly kind: 'ready' }
  | {
    readonly kind: 'change'
    readonly change:
      | { readonly absolutePath: string; readonly version: string }
      | { readonly absolutePath: string; readonly absent: true }
  }

/** `ctx.remote.workspaceFiles`, Client face. The session id selects the workspace root. */
export interface WorkspaceFilesRemote {
  readBytes(sessionId: string, path: string, options: object, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
  changes(sessionId: string, path: string, signal?: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame>
}

/** `dsh-resource://file/session/<sessionId>/<path>` parsed. */
export interface SessionFileAddress {
  readonly sessionId: string
  readonly path: string
}

/** The session-scoped address of a workspace path: segments component-encoded, `:` kept for drive letters. */
export function sessionFileAddress(sessionId: string, path: string): string {
  const encode = (segment: string): string => encodeURIComponent(segment).replace(/%3A/gi, ':')
  return `dsh-resource://file/session/${encode(sessionId)}/${path.split('/').map(encode).join('/')}`
}

/**
 * Parse a session-scoped file address. Segments are component-encoded; `absolute`
 * addresses are not editable here (they may lie outside any workspace).
 */
export function parseSessionFileAddress(address: string): SessionFileAddress | undefined {
  const match = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(address)
  if (match === null) return undefined
  try {
    return {
      sessionId: decodeURIComponent(match[1]!),
      path: match[2]!.split('/').map(decodeURIComponent).join('/'),
    }
  } catch {
    // A malformed percent sequence is not an address we can open.
    return undefined
  }
}
