/**
 * Per-scope editor view state in localStorage, following the right sidebar's
 * convention: versioned key, validated on read, a corrupt entry clears only its
 * own key, and storage failures leave the editor working in memory.
 *
 * File contents are never stored: disk is the single source of truth.
 */

/** Cursor and scroll of one file. */
export interface FileViewState {
  readonly anchor: number
  readonly head: number
  readonly scrollTop: number
}

export interface ScopeViewState {
  /** Path → view state. Paths are as the address carried them. */
  readonly files: Readonly<Record<string, FileViewState>>
}

export const STORAGE_PREFIX = 'dsh.editor.v1.'

/** Upper bound on remembered files per scope; the least recently written are dropped. */
const MAX_FILES = 200

/** The subset of `Storage` used; injectable for tests. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

function isFileViewState(value: unknown): value is FileViewState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isCount(v.anchor) && isCount(v.head) && typeof v.scrollTop === 'number' && v.scrollTop >= 0
}

function parse(raw: string): ScopeViewState | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const files = (value as { files?: unknown }).files
  if (typeof files !== 'object' || files === null || Array.isArray(files)) return undefined
  for (const entry of Object.values(files)) {
    if (!isFileViewState(entry)) return undefined
  }
  return { files: files as Record<string, FileViewState> }
}

export class ViewStateStore {
  private readonly cache = new Map<string, ScopeViewState>()

  constructor(private readonly storage: KeyValueStorage | undefined) {}

  private load(scopeKey: string): ScopeViewState {
    const cached = this.cache.get(scopeKey)
    if (cached !== undefined) return cached
    let state: ScopeViewState = { files: {} }
    try {
      const raw = this.storage?.getItem(STORAGE_PREFIX + scopeKey)
      if (raw != null) {
        const parsed = parse(raw)
        if (parsed === undefined) this.storage?.removeItem(STORAGE_PREFIX + scopeKey)
        else state = parsed
      }
    } catch {
      // Storage unavailable (private mode, quota, policy): stay in memory.
    }
    this.cache.set(scopeKey, state)
    return state
  }

  get(scopeKey: string, path: string): FileViewState | undefined {
    return this.load(scopeKey).files[path]
  }

  set(scopeKey: string, path: string, view: FileViewState): void {
    const files = { ...this.load(scopeKey).files }
    delete files[path]
    files[path] = view
    const keys = Object.keys(files)
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) delete files[stale]
    const state = { files }
    this.cache.set(scopeKey, state)
    try {
      this.storage?.setItem(STORAGE_PREFIX + scopeKey, JSON.stringify(state))
    } catch {
      // Storage write failed: keep the in-memory state.
    }
  }
}
