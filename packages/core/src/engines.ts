/**
 * Editor engines: which editor draws which file, chosen by extension.
 *
 * An engine is framework-agnostic: it mounts into a DOM element and talks to
 * the document through an {@link EngineBinding}. The text engine (CodeMirror)
 * ships with the template; a downstream project adds e.g. an `odt` engine by
 * registering it, without touching the template.
 *
 * The core reads, saves and syncs text only. An engine for another format
 * registers as self-managed ({@link SelfManagedEngine}): the core just mounts it.
 */
import type { SelectionInfo } from './context.ts'
import type { FileViewState } from './view-state.ts'

/** What an engine receives when it mounts one document. */
export interface EngineBinding {
  /** Workspace-relative (or absolute) path; the extension picked this engine. */
  readonly path: string
  /** Lower-case extension without the dot (`md`, `py`). */
  readonly extension: string
  readonly initialText: string
  /** Line separator the file uses; the engine must reproduce it on output. */
  readonly lineSeparator: '\n' | '\r\n'
  readonly initialView: FileViewState | undefined
  /** Localized text for the engine's own controls. */
  readonly labels: { readonly preview: string; readonly source: string }
  /** Report a user edit; the full new text. */
  onLocalChange(text: string): void
  /** Report cursor / scroll so it survives reloads. */
  onViewChange(view: FileViewState): void
  /** The user asked to save now (Ctrl+S). */
  save(): void
  /**
   * Cursor or selection moved, or the editor gained focus (AI context, design Q6).
   * `passive`: the move was not the user's (text arrived from disk); it refreshes
   * the context without making this editor the one that speaks for the session.
   */
  onSelection(info: SelectionInfo, passive: boolean): void
  /** The editor lost focus: the user is about to do something else, e.g. message the AI. */
  onBlur(): void
}

/** A mounted engine instance. */
export interface EngineInstance {
  /**
   * Replace the content with text that came from disk, keeping the cursor where
   * possible. The engine computes the change in its own coordinates (e.g.
   * CodeMirror counts a CRLF as one position); `diffText` helps.
   */
  applyExternal(text: string): void
  focus(): void
  destroy(): void
}

export interface EditorEngine {
  /** Unique engine id. */
  readonly id: string
  /** Lower-case extensions without the dot. */
  readonly extensions: readonly string[]
  mount(host: HTMLElement, binding: EngineBinding): EngineInstance
}

/**
 * What a self-managed engine receives: the file's address and the editor's
 * shared services, but no content. The engine reads, saves and watches the file
 * itself (for formats the text pipeline cannot hold, e.g. `.odt`).
 */
export interface SelfManagedBinding {
  readonly sessionId: string
  /** Workspace-relative (or absolute) path; the extension picked this engine. */
  readonly path: string
  /** Lower-case extension without the dot. */
  readonly extension: string
  /** The session's workspace root, when known. */
  readonly workspaceRoot: string | undefined
  readonly initialView: FileViewState | undefined
  /** Report cursor / scroll so it survives reloads. */
  onViewChange(view: FileViewState): void
  /** Cursor or selection moved, for the AI context; see {@link EngineBinding.onSelection}. */
  onSelection(info: SelectionInfo, passive: boolean): void
}

export interface SelfManagedInstance {
  /** Save pending changes now; awaited before a chat message is sent, so the AI reads what is on screen. */
  flush(): Promise<void>
  focus(): void
  /**
   * The view closes. A returned promise keeps the engine's element in the page,
   * hidden, until it settles (e.g. to finish a save that needs the live engine).
   */
  destroy(): void | Promise<void>
}

/**
 * An engine that manages its own document: the core resolves it by extension
 * and mounts it, and does nothing else for it (no reading, saving, status or
 * conflict handling).
 */
export interface SelfManagedEngine {
  /** Unique engine id. */
  readonly id: string
  /** Lower-case extensions without the dot. */
  readonly extensions: readonly string[]
  readonly selfManaged: true
  mount(host: HTMLElement, binding: SelfManagedBinding): SelfManagedInstance
}

/** Anything the registry holds. */
export type RegisteredEngine = EditorEngine | SelfManagedEngine

export function isSelfManaged(engine: RegisteredEngine): engine is SelfManagedEngine {
  return 'selfManaged' in engine && engine.selfManaged === true
}

/** Lower-case extension without the dot, or `''`. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The registered engines. A later registration claiming the same extension
 * shadows an earlier one until it unregisters, so a project can replace the
 * template's engine for one format.
 */
export class EngineRegistry {
  private readonly engines: RegisteredEngine[] = []

  register(engine: RegisteredEngine): () => void {
    if (this.engines.some(existing => existing.id === engine.id)) {
      throw new Error(`dsh-editor: engine "${engine.id}" is already registered`)
    }
    this.engines.push(engine)
    return () => {
      const index = this.engines.indexOf(engine)
      if (index >= 0) this.engines.splice(index, 1)
    }
  }

  /** The engine for a path, or undefined when no engine claims its extension. */
  resolve(path: string): RegisteredEngine | undefined {
    const extension = extensionOf(path)
    if (extension === '') return undefined
    for (let i = this.engines.length - 1; i >= 0; i--) {
      const engine = this.engines[i]!
      if (engine.extensions.includes(extension)) return engine
    }
    return undefined
  }
}
