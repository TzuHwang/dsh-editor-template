/**
 * Per-scope editor view state in localStorage, following the right sidebar's
 * convention: versioned key, validated on read, a corrupt entry clears only its
 * own key, and storage failures leave the editor working in memory.
 *
 * Two parts share one key per scope (design Q10): each file's cursor and
 * scroll, and the centre editor's tabs (layout B). File contents are never
 * stored: disk is the single source of truth.
 */

/** Cursor and scroll of one file. */
export interface FileViewState {
  readonly anchor: number
  readonly head: number
  readonly scrollTop: number
}

/** The centre editor's tabs (layout B). Paths are as session addresses carry them. */
export interface TabsState {
  readonly open: readonly string[]
  readonly active: string | null
}

export interface ScopeViewState {
  /** Path → view state. */
  readonly files: Readonly<Record<string, FileViewState>>
  readonly tabs: TabsState
}

export const STORAGE_PREFIX = 'dsh.editor.v1.'

/** Upper bound on remembered files per scope; the least recently written are dropped. */
const MAX_FILES = 200

const EMPTY_TABS: TabsState = { open: [], active: null }

/** The subset of `Storage` used; injectable for tests. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

function isFileViewState(value: unknown): value is FileViewState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isCount(v.anchor) && isCount(v.head) && typeof v.scrollTop === 'number' && v.scrollTop >= 0
}

function parseTabs(value: unknown): TabsState | undefined {
  // Absent in states written before tabs existed.
  if (value === undefined) return EMPTY_TABS
  if (typeof value !== 'object' || value === null) return undefined
  const { open, active } = value as { open?: unknown; active?: unknown }
  if (!Array.isArray(open) || !open.every(path => typeof path === 'string')) return undefined
  if (active !== null && (typeof active !== 'string' || !open.includes(active))) return undefined
  return { open: open as string[], active }
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
  const tabs = parseTabs((value as { tabs?: unknown }).tabs)
  if (tabs === undefined) return undefined
  return { files: files as Record<string, FileViewState>, tabs }
}

export class ViewStateStore {
  private readonly cache = new Map<string, ScopeViewState>()
  /** Loaded scopes' tabs, published as one stable snapshot for React selectors. */
  private tabsSnapshot: Readonly<Record<string, TabsState>> = {}
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: KeyValueStorage | undefined) {}

  private load(scopeKey: string): ScopeViewState {
    const cached = this.cache.get(scopeKey)
    if (cached !== undefined) return cached
    let state: ScopeViewState = { files: {}, tabs: EMPTY_TABS }
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

  private save(scopeKey: string, state: ScopeViewState): void {
    this.cache.set(scopeKey, state)
    try {
      this.storage?.setItem(STORAGE_PREFIX + scopeKey, JSON.stringify(state))
    } catch {
      // Storage write failed: keep the in-memory state.
    }
  }

  get(scopeKey: string, path: string): FileViewState | undefined {
    return this.load(scopeKey).files[path]
  }

  set(scopeKey: string, path: string, view: FileViewState): void {
    const current = this.load(scopeKey)
    const files = { ...current.files }
    delete files[path]
    files[path] = view
    const keys = Object.keys(files)
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) delete files[stale]
    this.save(scopeKey, { ...current, files })
  }

  // Centre tabs, observable (`getTabsSnapshot` / `subscribe`).

  getTabsSnapshot = (): Readonly<Record<string, TabsState>> => this.tabsSnapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Make a scope's tabs part of the snapshot (call from an effect, not during render). */
  ensureTabs(scopeKey: string): void {
    if (scopeKey in this.tabsSnapshot) return
    this.publishTabs(scopeKey, this.load(scopeKey).tabs)
  }

  /** Open a path as a tab (or focus it) and make it active. */
  openTab(scopeKey: string, path: string): void {
    const { open } = this.load(scopeKey).tabs
    this.setTabs(scopeKey, { open: open.includes(path) ? open : [...open, path], active: path })
  }

  activateTab(scopeKey: string, path: string): void {
    const { open } = this.load(scopeKey).tabs
    if (open.includes(path)) this.setTabs(scopeKey, { open, active: path })
  }

  /** Close a tab; the neighbour to its right (else left) becomes active. */
  closeTab(scopeKey: string, path: string): void {
    const { open, active } = this.load(scopeKey).tabs
    const index = open.indexOf(path)
    if (index < 0) return
    const next = open.filter(candidate => candidate !== path)
    const nextActive = active !== path ? active : (next[index] ?? next[index - 1] ?? null)
    this.setTabs(scopeKey, { open: next, active: nextActive })
  }

  private setTabs(scopeKey: string, tabs: TabsState): void {
    this.save(scopeKey, { ...this.load(scopeKey), tabs })
    this.publishTabs(scopeKey, tabs)
  }

  private publishTabs(scopeKey: string, tabs: TabsState): void {
    this.tabsSnapshot = { ...this.tabsSnapshot, [scopeKey]: tabs }
    for (const listener of this.listeners) listener()
  }
}
