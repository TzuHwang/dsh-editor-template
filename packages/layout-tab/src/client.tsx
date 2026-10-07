/**
 * Layout A (design Q1/Q8): the editor is a right-sidebar tab type.
 *
 * It claims every session file address an engine supports, in the `extension`
 * band, so it outranks DSH's read-only `text` preview (`fallback`) for those
 * files and leaves everything else to DSH. Verified by spike S1. Active only
 * while the `layout` setting is `tab`.
 */
import type { CordisContext, EditorService, Translate } from '@dsh-editor/core'
import { CHAT_TAB_KIND, EDITOR_TAB_KIND, REDIRECT_TAB_KIND } from '@dsh-editor/core/kinds'
import { useEffect, useRef } from 'react'

export const name = 'dsh-editor-layout-tab'
export const inject = ['editor', 'slots', 'sidebarRightTabs']

const TAB_ID = '@dsh-editor/layout-tab'
const KIND = EDITOR_TAB_KIND
/** The frame's dictionary, registered by @dsh-editor/core. */
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

function mount(ctx: CordisContext, editor: EditorService): () => void {
  const slots = ctx.slots as Slots
  const tabs = ctx.sidebarRightTabs as { register(definition: object): () => void }
  const disposeType = tabs.register({
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
  })
  const attach = (host: HTMLElement, address: string, workspaceRoot: string | undefined, t: Translate) =>
    editor.attachFrame(host, { address, workspaceRoot, t })
  const disposeBody = slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => ({ attach }) },
    EditorTab as (props: never) => unknown,
  ))
  // Tabs saved while layout B was active: a chat tab closes (the centre has the
  // conversation here); a redirected file reopens as an editor tab.
  const disposeLegacy = [CHAT_TAB_KIND, REDIRECT_TAB_KIND].flatMap((kind) => {
    const id = `${TAB_ID}/legacy-${kind}`
    return [
      tabs.register({ id, kind, multiple: true, title: basename }),
      slots.inject('sidebar.right.pane.tab', () => slots.register(
        { name: 'sidebar.right.pane.tab', key: id },
        Retire as (props: never) => unknown,
      )),
    ]
  })
  return () => {
    for (const dispose of disposeLegacy) dispose()
    disposeBody()
    disposeType()
  }
}

interface RetireProps {
  readonly useTabInfo: () => {
    readonly tab: {
      readonly kind: string
      readonly contentId: string
      readonly actions: { close(): void; openResource(address: string): void }
    }
  }
}

/** Body for the other layout's tabs: reopen a file as an editor tab, then close. */
function Retire({ useTabInfo }: RetireProps) {
  const { tab } = useTabInfo()
  useEffect(() => {
    if (tab.kind === REDIRECT_TAB_KIND) tab.actions.openResource(tab.contentId)
    tab.actions.close()
  }, [tab])
  return null
}

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const sync = (): void => {
      const active = editor.settings.getSnapshot()?.layout === 'tab'
      if (active && dispose === undefined) dispose = mount(ctx, editor)
      if (!active && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    }
    const unsubscribe = editor.settings.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
    }
  }, 'dsh-editor: layout A')
}
