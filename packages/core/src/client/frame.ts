/**
 * The editor frame: status line, conflict / missing / error banner, and the
 * engine underneath. Built with plain DOM in the plugin's apply world, so the
 * React mount (sidebar tab or center) only hands over an element (DSH components carry no
 * subscriptions of their own).
 */
import type { DocumentStatus } from '../document.ts'
import { isSelfManaged, type EngineInstance, type SelfManagedEngine } from '../engines.ts'
import type { SessionFileAddress } from '../contract/dsh.ts'
import type { EditorService } from './service.ts'
import { toEditorContext, type EditorContext, type SelectionInfo } from '../context.ts'

export type Translate = (key: string, params?: Record<string, string>) => string

export interface FrameTarget {
  readonly address: string
  readonly workspaceRoot: string | undefined
  readonly t: Translate
}

const STYLE = `
.dsh-editor-frame { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-editor-frame__status { font-size: 11px; padding: 2px 10px; opacity: 0.6; min-height: 16px; }
.dsh-editor-frame__banner { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; padding: 6px 10px; background: color-mix(in srgb, #f5a623 18%, transparent); }
.dsh-editor-frame__banner[hidden] { display: none; }
.dsh-editor-frame__banner button { font: inherit; padding: 1px 8px; border-radius: 4px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; cursor: pointer; }
.dsh-editor-frame__engine { flex: 1; min-height: 0; }
.dsh-editor-frame__message { padding: 16px; font-size: 13px; opacity: 0.7; }
`

function ensureStyle(document: Document): void {
  if (document.querySelector('style[data-dsh-editor-frame]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshEditorFrame = ''
  style.textContent = STYLE
  document.head.appendChild(style)
}

/** Mount the editor for one address into `host`; returns the detach function. */
export function attachFrame(editor: EditorService, host: HTMLElement, target: FrameTarget): () => void {
  const { t } = target
  const document = host.ownerDocument
  ensureStyle(document)
  const root = el(document, 'div', 'dsh-editor-frame')
  host.append(root)

  const file = editor.parseAddress(target.address)
  const engine = file === undefined ? undefined : editor.engines.resolve(file.path)
  if (file === undefined || engine === undefined) {
    root.append(message(document, t('unsupported')))
    return () => root.remove()
  }
  if (isSelfManaged(engine)) return attachSelfManaged(editor, root, engine, file, target.workspaceRoot)

  const status = el(document, 'div', 'dsh-editor-frame__status')
  const banner = el(document, 'div', 'dsh-editor-frame__banner')
  banner.hidden = true
  const engineHost = el(document, 'div', 'dsh-editor-frame__engine')
  status.dataset.testid = 'dsh-editor-status'
  root.append(banner, status, engineHost)
  status.textContent = t('status.loading')

  const handle = editor.openDocument(file)
  const scopeKey = editor.scopeKey(file.sessionId, target.workspaceRoot)
  let instance: EngineInstance | undefined
  let unsubscribe: (() => void) | undefined
  let detached = false
  const context = contextReporter(editor, file, root)

  void handle.ready.then(() => {
    if (detached) return
    instance = engine.mount(engineHost, {
      path: file.path,
      extension: file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase(),
      initialText: handle.doc.getText(),
      lineSeparator: handle.lineSeparator(),
      initialView: scopeKey === null ? undefined : editor.viewState.get(scopeKey, file.path),
      labels: { preview: t('engine.preview'), source: t('engine.source') },
      onLocalChange: text => handle.doc.edit(text),
      onViewChange: view => { if (scopeKey !== null) editor.viewState.set(scopeKey, file.path, view) },
      save: () => { void handle.doc.flush() },
      onSelection: context.onSelection,
      // Leaving the editor (e.g. to message the AI) saves now, so the AI reads what the user sees.
      onBlur: () => { void handle.doc.flush() },
    })
    unsubscribe = handle.doc.subscribe({
      status: next => render(next),
      external: text => instance?.applyExternal(text),
    })
    render(handle.doc.status)
  }, (error: unknown) => {
    if (detached) return
    status.remove()
    engineHost.replaceChildren(message(document, t('error.open', { reason: error instanceof Error ? error.message : String(error) })))
  })

  function render(next: DocumentStatus): void {
    status.textContent = next.kind === 'conflict' || next.kind === 'missing' || next.kind === 'error' ? '' : t(`status.${next.kind}`)
    banner.replaceChildren()
    banner.hidden = true
    if (next.kind === 'conflict') {
      banner.hidden = false
      banner.dataset.testid = 'dsh-editor-conflict'
      banner.append(
        text(document, t('conflict.message')),
        button(document, t('conflict.useDisk'), () => { void handle.doc.resolveConflict('disk') }),
        button(document, t('conflict.keepMine'), () => { void handle.doc.resolveConflict('mine') }),
      )
    } else if (next.kind === 'missing') {
      banner.hidden = false
      banner.append(text(document, t('missing')))
    } else if (next.kind === 'error') {
      banner.hidden = false
      banner.append(
        text(document, t('error.save', { reason: next.message })),
        button(document, t('retry'), () => { void handle.doc.flush() }),
      )
    }
  }

  return () => {
    detached = true
    context.release()
    unsubscribe?.()
    instance?.destroy()
    handle.release()
    root.remove()
  }
}

/**
 * A self-managed engine gets the frame's element and nothing else from the
 * document side: no status line, banner, reads or saves. It is included in
 * `flushAll`, and its view state and AI context go through the shared stores.
 */
function attachSelfManaged(
  editor: EditorService,
  root: HTMLElement,
  engine: SelfManagedEngine,
  file: SessionFileAddress,
  workspaceRoot: string | undefined,
): () => void {
  const engineHost = el(root.ownerDocument, 'div', 'dsh-editor-frame__engine')
  root.append(engineHost)
  const scopeKey = editor.scopeKey(file.sessionId, workspaceRoot)
  const context = contextReporter(editor, file, root)
  const instance = engine.mount(engineHost, {
    sessionId: file.sessionId,
    path: file.path,
    extension: file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase(),
    workspaceRoot,
    initialView: scopeKey === null ? undefined : editor.viewState.get(scopeKey, file.path),
    onViewChange: view => { if (scopeKey !== null) editor.viewState.set(scopeKey, file.path, view) },
    onSelection: context.onSelection,
  })
  const removeFlusher = editor.addFlusher(() => instance.flush())

  return () => {
    removeFlusher()
    context.release()
    const closing = instance.destroy()
    if (closing === undefined) {
      root.remove()
      return
    }
    // The engine finishes something (e.g. a save) that needs it alive: keep it in the page, hidden.
    root.style.display = 'none'
    void closing.catch(() => undefined).finally(() => root.remove())
  }
}

/**
 * A view's cursor and selection, reported for the AI. A view can be hidden
 * and shown again without remounting (kept tabs); when it shows, its last
 * report speaks for the session again, so the AI sees the file on screen.
 */
function contextReporter(editor: EditorService, file: SessionFileAddress, root: HTMLElement): {
  onSelection(info: SelectionInfo, passive: boolean): void
  release(): void
} {
  /** This view's identity in the per-session context store. */
  const owner = {}
  let last: EditorContext | undefined
  const visible = (): boolean => root.getClientRects().length > 0
  let shown = visible()
  // Hiding (display: none on an ancestor) and showing again both change the box.
  const observer = new ResizeObserver(() => {
    const now = visible()
    if (now && !shown && last !== undefined) editor.context.set(file.sessionId, owner, last)
    shown = now
  })
  observer.observe(root)
  return {
    onSelection(info, passive) {
      last = toEditorContext(file.path, info)
      if (passive) editor.context.update(file.sessionId, owner, last)
      else editor.context.set(file.sessionId, owner, last)
    },
    release() {
      observer.disconnect()
      editor.context.release(file.sessionId, owner)
    },
  }
}

function el(document: Document, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function message(document: Document, content: string): HTMLElement {
  const node = el(document, 'div', 'dsh-editor-frame__message')
  node.textContent = content
  return node
}

function text(document: Document, content: string): HTMLElement {
  const node = document.createElement('span')
  node.textContent = content
  return node
}

function button(document: Document, label: string, onClick: () => void): HTMLElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}

