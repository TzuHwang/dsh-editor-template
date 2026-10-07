/**
 * Layout A (design Q1/Q8): the editor is a right-sidebar tab type.
 *
 * It claims every session file address an engine supports, in the `extension`
 * band, so it outranks DSH's read-only `text` preview (`fallback`) for those
 * files and leaves everything else to DSH. Verified by spike S1.
 */
import type { CordisContext, EditorService } from '@dsh-editor/core'
import { useEffect, useRef } from 'react'
import { attachFrame, type Translate } from './frame.ts'
import { en, zh } from './locales.ts'

export const name = 'dsh-editor-layout-tab'
export const inject = ['editor', 'slots', 'sidebarRightTabs', 'locale']

const TAB_ID = '@dsh-editor/layout-tab'
const KIND = 'dsh-editor'
const NS = 'dshEditor'

interface Slots {
  inject(name: string, callback: () => () => void): () => void
  register(options: object, component: (props: never) => unknown): () => void
}

interface TabBodyProps {
  readonly sessionId: string
  readonly useTabInfo: () => { readonly tab: { readonly contentId: string } }
  readonly useSessions: <T>(selector: (state: { byId: Record<string, { cwd?: string } | undefined> }) => T) => T
  readonly t: Translate
  readonly attach: (host: HTMLElement, address: string, workspaceRoot: string | undefined, t: Translate) => () => void
}

function basename(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function EditorTab({ sessionId, useTabInfo, useSessions, t, attach }: TabBodyProps) {
  const address = useTabInfo().tab.contentId
  const workspaceRoot = useSessions(state => state.byId[sessionId]?.cwd)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (host.current === null) return undefined
    return attach(host.current, address, workspaceRoot, t)
    // `t` changes identity with the language; the frame re-attaches then, which is rare and cheap.
  }, [address, workspaceRoot, t, attach])
  return <div ref={host} style={{ height: '100%', minHeight: 0 }} />
}

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  const slots = ctx.slots as Slots
  const tabs = ctx.sidebarRightTabs as { register(definition: object): () => void }
  const locale = ctx.locale as { register(ns: string, dicts: Record<string, object>): () => void }

  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-editor: dictionaries')
  ctx.effect(() => tabs.register({
    id: TAB_ID,
    kind: KIND,
    multiple: true,
    patterns: ['dsh-resource://file/**'],
    priority: 'extension',
    canOpen: (address: string) => {
      const file = editor.parseAddress(address)
      return file !== undefined && editor.engines.resolve(file.path) !== undefined
    },
    title: basename,
  }), 'dsh-editor: tab type')

  const attach = (host: HTMLElement, address: string, workspaceRoot: string | undefined, t: Translate) =>
    attachFrame(editor, host, { address, workspaceRoot, t })
  ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => ({ attach }) },
    EditorTab as (props: never) => unknown,
  )), 'dsh-editor: tab body')
}
