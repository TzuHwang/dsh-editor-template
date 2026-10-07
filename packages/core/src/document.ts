/**
 * One open file kept in sync with disk (design decision Q5: disk is the single
 * source of truth).
 *
 * - User edits autosave after a debounce; `flush()` saves now (before a chat
 *   message is sent, on Ctrl+S).
 * - Every save is guarded by the version last read, so a concurrent AI write is
 *   never overwritten: the host answers `stale` and we reconcile.
 * - An external change is read and compared by content, not only version, so
 *   our own write echoing back through the watcher is a no-op.
 * - Changed on disk while clean → applied as a diff; while dirty → conflict,
 *   resolved by the user (`resolveConflict`).
 *
 * Saves and reconciles run one at a time through a queue; edits are synchronous.
 */
import { diffText, type TextChange } from './diff.ts'

export interface DiskText {
  readonly text: string
  readonly version: string
}

export type WriteResult =
  | { readonly kind: 'ok'; readonly version: string }
  | { readonly kind: 'stale' }
  | { readonly kind: 'error'; readonly message: string }

/** File access for one document; the client wires it to DSH. */
export interface DocumentIO {
  /** Read the file; undefined when it does not exist. */
  read(): Promise<DiskText | undefined>
  /** Write the whole text; `expectedVersion` guards against a concurrent change, undefined writes unconditionally. */
  write(text: string, expectedVersion: string | undefined): Promise<WriteResult>
}

export type DocumentStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'clean' }
  | { readonly kind: 'dirty' }
  | { readonly kind: 'saving' }
  /** Disk and editor diverged; `diskText` is what is on disk now. */
  | { readonly kind: 'conflict'; readonly diskText: string }
  /** The file was deleted on disk; the next save recreates it. */
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string }

export interface DocumentListener {
  status?(status: DocumentStatus): void
  /** Text arrived from disk; the engine applies `changes` (in the old text's coordinates). */
  external?(text: string, changes: readonly TextChange[]): void
}

/** Timer seam so tests drive the debounce. */
export interface Scheduler {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realScheduler: Scheduler = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface DocumentOptions {
  readonly debounceMs?: number
  readonly scheduler?: Scheduler
}

export class DocumentSync {
  /** What the editor shows. */
  private text = ''
  /** What we believe is on disk. */
  private base = ''
  /** Version of `base`; undefined when the file is missing. */
  private version: string | undefined
  private current: DocumentStatus = { kind: 'loading' }
  private timer: unknown
  private queue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<DocumentListener>()
  private readonly debounceMs: number
  private readonly scheduler: Scheduler
  private disposed = false

  constructor(private readonly io: DocumentIO, options: DocumentOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500
    this.scheduler = options.scheduler ?? realScheduler
  }

  get status(): DocumentStatus {
    return this.current
  }

  getText(): string {
    return this.text
  }

  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read the file; resolves with its text. Rejects when it cannot be read. */
  async load(): Promise<string> {
    const disk = await this.io.read()
    if (disk === undefined) {
      this.version = undefined
      this.setStatus({ kind: 'missing' })
      return ''
    }
    this.text = this.base = disk.text
    this.version = disk.version
    this.setStatus({ kind: 'clean' })
    return disk.text
  }

  /** A user edit: the full new text. */
  edit(text: string): void {
    if (this.disposed || text === this.text) return
    this.text = text
    // A conflict stays until the user resolves it; never autosave over disk.
    if (this.current.kind === 'conflict') return
    if (this.current.kind !== 'saving') this.setStatus({ kind: 'dirty' })
    this.schedule()
  }

  /** Save now if there is anything to save; resolves when all queued work settled. */
  flush(): Promise<void> {
    this.cancelTimer()
    this.enqueue(() => this.save())
    return this.queue
  }

  /** The watcher saw the file change (`version`) or disappear (`undefined`). */
  externalChange(version: string | undefined): Promise<void> {
    this.enqueue(async () => {
      if (version !== undefined && version === this.version) return
      await this.reconcile()
    })
    return this.queue
  }

  /** Settle a conflict: take what is on disk, or keep the editor's text and overwrite. */
  resolveConflict(choice: 'disk' | 'mine'): Promise<void> {
    const status = this.current
    if (status.kind !== 'conflict') return this.queue
    if (choice === 'disk') {
      const changes = diffText(this.text, status.diskText)
      this.text = this.base = status.diskText
      this.emitExternal(this.text, changes)
      this.setStatus({ kind: 'clean' })
      return this.queue
    }
    this.setStatus({ kind: 'dirty' })
    return this.flush()
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimer()
    this.listeners.clear()
  }

  private schedule(): void {
    this.cancelTimer()
    this.timer = this.scheduler.set(() => {
      this.timer = undefined
      this.enqueue(() => this.save())
    }, this.debounceMs)
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.scheduler.clear(this.timer)
    this.timer = undefined
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(() => this.disposed ? undefined : task()).catch((error: unknown) => {
      this.setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  private async save(): Promise<void> {
    if (this.current.kind === 'conflict' || this.current.kind === 'loading') return
    if (this.text === this.base) {
      // Nothing to write. A deleted file stays deleted until the user edits it.
      if (this.current.kind !== 'clean' && this.current.kind !== 'missing') this.setStatus({ kind: 'clean' })
      return
    }
    const snapshot = this.text
    this.setStatus({ kind: 'saving' })
    const result = await this.io.write(snapshot, this.version)
    if (result.kind === 'ok') {
      this.base = snapshot
      this.version = result.version
      if (this.text === this.base) {
        this.setStatus({ kind: 'clean' })
      } else {
        // Edited while the write was in flight.
        this.setStatus({ kind: 'dirty' })
        this.schedule()
      }
      return
    }
    if (result.kind === 'stale') {
      await this.reconcile()
      return
    }
    this.setStatus({ kind: 'error', message: result.message })
  }

  /** Compare disk with what we have and act; see the module comment. */
  private async reconcile(): Promise<void> {
    const disk = await this.io.read()
    if (disk === undefined) {
      this.version = undefined
      this.setStatus({ kind: 'missing' })
      return
    }
    this.version = disk.version
    if (disk.text === this.base) {
      // Only metadata moved (or our own write echoed back).
      if (this.text !== this.base && this.current.kind === 'saving') this.setStatus({ kind: 'dirty' })
      if (this.text !== this.base && this.current.kind === 'dirty') this.schedule()
      return
    }
    if (disk.text === this.text) {
      // Disk caught up with the editor (e.g. the AI wrote what the user typed).
      this.base = disk.text
      this.setStatus({ kind: 'clean' })
      return
    }
    if (this.text === this.base) {
      const changes = diffText(this.text, disk.text)
      this.text = this.base = disk.text
      this.emitExternal(this.text, changes)
      this.setStatus({ kind: 'clean' })
      return
    }
    this.cancelTimer()
    this.setStatus({ kind: 'conflict', diskText: disk.text })
  }

  private setStatus(status: DocumentStatus): void {
    this.current = status
    for (const listener of this.listeners) listener.status?.(status)
  }

  private emitExternal(text: string, changes: readonly TextChange[]): void {
    for (const listener of this.listeners) listener.external?.(text, changes)
  }
}
