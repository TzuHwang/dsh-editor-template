/**
 * The editor frame: status line, conflict / missing / error banner, and the
 * engine underneath. Built with plain DOM in the plugin's apply world, so the
 * React tab body only hands over an element (DSH components carry no
 * subscriptions of their own).
 */
import type { DocumentStatus, EditorService, EngineInstance, SessionFileAddress } from '@dsh-editor/core'

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

  const status = el(document, 'div', 'dsh-editor-frame__status')
  const banner = el(document, 'div', 'dsh-editor-frame__banner')
  banner.hidden = true
  const engineHost = el(document, 'div', 'dsh-editor-frame__engine')
  status.dataset.testid = 'dsh-editor-status'
  root.append(banner, status, engineHost)
  status.textContent = t('status.loading')

  const handle = editor.openDocument(file)
  const scopeKey = editor.scopes.get(editor.scopeId).resolveKey({ workspaceRoot: target.workspaceRoot, sessionId: file.sessionId })
  let instance: EngineInstance | undefined
  let unsubscribe: (() => void) | undefined
  let detached = false

  void handle.ready.then(() => {
    if (detached) return
    instance = engine.mount(engineHost, {
      path: file.path,
      extension: file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase(),
      initialText: handle.doc.getText(),
      lineSeparator: handle.lineSeparator(),
      initialView: scopeKey === null ? undefined : editor.viewState.get(scopeKey, file.path),
      onLocalChange: text => handle.doc.edit(text),
      onViewChange: view => { if (scopeKey !== null) editor.viewState.set(scopeKey, file.path, view) },
      save: () => { void handle.doc.flush() },
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
    unsubscribe?.()
    instance?.destroy()
    handle.release()
    root.remove()
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

export type { SessionFileAddress }
