/**
 * The editor's save route, shared by host and client.
 *
 * DSH 0.2's `workspaceFiles` Remote is read-only, so saving goes through this
 * plugin-owned HTTP route, authenticated by DSH's connection like the built-in
 * open-in-app routes. Request: POST JSON {@link WriteRequest}. Responses:
 * 200 `{ version }`, 409 `{ error: 'stale' }` when the file changed since
 * `version`, 4xx/5xx `{ error }` otherwise.
 */
export const WRITE_ROUTE = '/dsh-editor/write'

export interface WriteRequest {
  readonly sessionId: string
  /** Workspace-relative or absolute path; it must resolve inside the session's workspace. */
  readonly path: string
  readonly content: string
  /** Version last read; omitted for an unconditional write (recreating a deleted file, keeping "mine"). */
  readonly version?: string
}

/** Requests above this are refused; matches workspaceFiles' default `maxFileBytes`. */
export const MAX_WRITE_BYTES = 32 * 1024 * 1024
