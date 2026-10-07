/**
 * `ctx.editor`: the registries plus the open documents, shared by every mount
 * (A: right-sidebar tab, B: centre). Documents are reference-counted so two
 * views of one file share one sync state.
 */
import { parseSessionFileAddress, sessionFileAddress, type SessionFileAddress, type WorkspaceFilesRemote } from '../contract/dsh.ts'
import { DocumentSync, type DiskText, type DocumentIO, type WriteResult } from '../document.ts'
import { EngineRegistry } from '../engines.ts'
import { ScopeRegistry, sessionScope, workspaceScope } from '../scopes.ts'
import { decodeText } from '../text-codec.ts'
import { ViewStateStore } from '../view-state.ts'
import { ContextStore } from '../context.ts'
import { WRITE_ROUTE } from '../write-route.ts'
import { attachFrame, type FrameTarget } from './frame.ts'

export interface DocumentHandle {
  readonly doc: DocumentSync
  /** Resolves once the first read settled (rejects when the file cannot be opened as text). */
  readonly ready: Promise<void>
  /** Line separator of the file as last read. */
  lineSeparator(): '\n' | '\r\n'
  release(): void
}

interface OpenDocument {
  readonly doc: DocumentSync
  readonly ready: Promise<void>
  readonly watch: AbortController
  readonly format: { lineSeparator: '\n' | '\r\n' }
  refs: number
}

/** A version no file has: forces a content comparison after the watcher reconnects. */
const RESYNC = '\0resync'

/** Editor settings as the browser sees them; `undefined` until DSH's settings answered. */
export interface EditorSettings {
  readonly layout: 'tab' | 'main'
  readonly scope: string
}

export const DEFAULT_SETTINGS: EditorSettings = { layout: 'tab', scope: workspaceScope.id }

export class EditorService {
  readonly engines = new EngineRegistry()
  readonly scopes = new ScopeRegistry()
  readonly viewState: ViewStateStore
  /** What each session's editor shows, for the AI (design Q6). */
  readonly context = new ContextStore()
  private readonly open = new Map<string, OpenDocument>()
  private settingsValue: EditorSettings | undefined
  private readonly settingsListeners = new Set<() => void>()

  constructor(private readonly files: WorkspaceFilesRemote, storage: Storage | undefined) {
    this.viewState = new ViewStateStore(storage)
    this.scopes.register(workspaceScope)
    this.scopes.register(sessionScope)
  }

  /** Settings (design Q9): mounts register for their layout once these are known. */
  readonly settings = {
    getSnapshot: (): EditorSettings | undefined => this.settingsValue,
    subscribe: (listener: () => void): (() => void) => {
      this.settingsListeners.add(listener)
      return () => { this.settingsListeners.delete(listener) }
    },
  }

  /** Called by the core plugin once DSH's settings answered. */
  applySettings(settings: EditorSettings): void {
    this.settingsValue = settings
    for (const listener of this.settingsListeners) listener()
  }

  /** Selected scope strategy id (design Q7). */
  get scopeId(): string {
    return (this.settingsValue ?? DEFAULT_SETTINGS).scope
  }

  /** Mount the editor (status, banners, engine) for one address into `host`; returns the detach function. */
  attachFrame(host: HTMLElement, target: FrameTarget): () => void {
    return attachFrame(this, host, target)
  }

  /** The view-state scope key for a session, or null when it has none. */
  scopeKey(sessionId: string | undefined, workspaceRoot: string | undefined): string | null {
    return this.scopes.get(this.scopeId).resolveKey({ sessionId, workspaceRoot })
  }

  /** Parse a `dsh-resource://file/session/…` address; undefined for anything else. */
  parseAddress(address: string): SessionFileAddress | undefined {
    return parseSessionFileAddress(address)
  }

  /** The address of a workspace path in a session (inverse of `parseAddress`). */
  addressFor(sessionId: string, path: string): string {
    return sessionFileAddress(sessionId, path)
  }

  /** Open (or share) the document for one session file. */
  openDocument(file: SessionFileAddress): DocumentHandle {
    const key = `${file.sessionId}\0${file.path}`
    let entry = this.open.get(key)
    if (entry === undefined) {
      const format = { lineSeparator: '\n' as '\n' | '\r\n' }
      const doc = new DocumentSync(this.createIO(file, separator => { format.lineSeparator = separator }))
      const watch = new AbortController()
      entry = { doc, ready: doc.load().then(() => undefined), watch, format, refs: 0 }
      this.watch(file, doc, watch.signal)
      this.open.set(key, entry)
    }
    entry.refs++
    const opened = entry
    let released = false
    return {
      doc: opened.doc,
      ready: opened.ready,
      lineSeparator: () => opened.format.lineSeparator,
      release: () => {
        if (released) return
        released = true
        if (--opened.refs > 0) return
        // Last view closed: save what is pending, then stop watching.
        void opened.doc.flush().finally(() => {
          if (opened.refs > 0) return
          opened.watch.abort()
          opened.doc.dispose()
          this.open.delete(key)
        })
      },
    }
  }

  /** Save every open document now; called before a chat message is sent (M2) and on Ctrl+S. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.open.values()].map(entry => entry.doc.flush()))
  }

  private createIO(file: SessionFileAddress, onSeparator: (separator: '\n' | '\r\n') => void): DocumentIO {
    return {
      read: async (): Promise<DiskText | undefined> => {
        const result = await this.files.readBytes(file.sessionId, file.path, {})
        if (!result.ok) {
          if (result.error.code === 'workspace-file/not-found') return undefined
          throw new Error(result.error.code)
        }
        const decoded = decodeText(result.value.data)
        onSeparator(decoded.lineSeparator)
        return { text: decoded.text, version: result.value.version }
      },
      write: async (text: string, expectedVersion: string | undefined): Promise<WriteResult> => {
        let response: Response
        try {
          response = await fetch(WRITE_ROUTE.slice(1), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: file.sessionId, path: file.path, content: text, version: expectedVersion }),
          })
        } catch (error) {
          return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
        }
        const body = await response.json().catch(() => ({})) as { version?: string; error?: string }
        if (response.status === 200 && typeof body.version === 'string') return { kind: 'ok', version: body.version }
        if (response.status === 409) return { kind: 'stale' }
        return { kind: 'error', message: body.error ?? `HTTP ${response.status}` }
      },
    }
  }

  /** Follow the file's change feed for the document's lifetime, reconnecting after failures. */
  private watch(file: SessionFileAddress, doc: DocumentSync, signal: AbortSignal): void {
    void (async () => {
      let attempt = 0
      while (!signal.aborted) {
        try {
          for await (const frame of this.files.changes(file.sessionId, file.path, signal)) {
            if (frame.kind === 'ready') {
              // Anything that changed while we were not watching.
              if (attempt > 0) void doc.externalChange(RESYNC)
              attempt = 0
              continue
            }
            void doc.externalChange('version' in frame.change ? frame.change.version : undefined)
          }
        } catch {
          // Stream failed (reconnect, host restart): retry below.
        }
        if (signal.aborted) return
        attempt++
        await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))))
      }
    })()
  }
}
