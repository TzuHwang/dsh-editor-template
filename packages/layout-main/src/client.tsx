/**
 * Layout B (design Q1, spike S2): the editor fills the centre, the AI chat is a
 * right-sidebar tab. Active only while the `layout` setting is `main`.
 *
 * - Centre: occupies `main.conversation` with a shadowing registration (a
 *   `single` slot is a documented replacement point), so it gets the selected
 *   session. The registration is withdrawn, showing DSH's own conversation,
 *   while no session or a blank one is selected (DSH's start screen picks the
 *   workspace and takes the first message, M3-2), and while the user asked for
 *   the full conversation.
 * - Files opened from the sidebar land in the centre (M3-1): a redirect tab
 *   type outranks layout A's and DSH's viewers, hands the file to the centre
 *   and closes itself.
 * - Chat: see chat.tsx.
 */
import type { ContextSnapshot, CordisContext, EditorService, Translate } from '@dsh-editor/core'
import { effectiveContext } from '@dsh-editor/core/context'
import { CHAT_TAB_KIND as CHAT_KIND, EDITOR_TAB_KIND, REDIRECT_TAB_KIND as REDIRECT_KIND } from '@dsh-editor/core/kinds'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect } from 'react'
import { Center } from './center.tsx'
import { CHAT_STYLE, Chat } from './chat.tsx'
import { en, zh } from './locales.ts'

export const name = 'dsh-editor-layout-main'
export const inject = ['editor', 'slots', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'uiSession', 'locale']

const NS = 'dshEditorMain'
const FRAME_NS = 'dshEditor'
const CHAT_ID = '@dsh-editor/layout-main/chat'
const REDIRECT_ID = '@dsh-editor/layout-main/redirect'
const LEGACY_ID = '@dsh-editor/layout-main/legacy-editor'
/** DSH's file-tree tab kind (@deepseek-ai/dsh-client-ui-sidebar-files). */
const FILES_KIND = 'files'

// DSH surfaces, typed locally (see @dsh-editor/core contract/dsh.ts).
interface Slots {
  inject(name: string, callback: () => () => void): () => void
  register(options: object, component: (props: never) => unknown): () => void
}
interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
interface Conversation {
  send(text: string): Promise<void>
  cancel(): Promise<void>
}
interface Sessions {
  readonly list: Observable<{ byId: Record<string, { cwd?: string; blank: boolean } | undefined> }>
  scope(id: string): { get(name: 'conversation'): Conversation | undefined } | undefined
}
interface Locale {
  register(ns: string, dicts: Record<string, object>): () => void
  bind(ns: string): Translate
}

function ensureStyle(): () => void {
  const style = document.createElement('style')
  style.dataset.dshEditorChat = ''
  style.textContent = CHAT_STYLE
  document.head.appendChild(style)
  return () => style.remove()
}

/** Watch several observables with one callback; returns the disposer. */
function watch(sources: readonly Observable<unknown>[], sync: () => void): () => void {
  const disposers = sources.map(source => source.subscribe(sync))
  sync()
  return () => { for (const dispose of disposers) dispose() }
}

interface RedirectProps {
  readonly sessionId: string
  readonly useTabInfo: () => { readonly tab: { readonly contentId: string; readonly actions: { close(): void } } }
  readonly openInCenter: (sessionId: string, address: string) => void
}

/** Body of the redirect tab: hand the file to the centre, then close. */
function Redirect({ sessionId, useTabInfo, openInCenter }: RedirectProps) {
  const { tab } = useTabInfo()
  useEffect(() => {
    openInCenter(sessionId, tab.contentId)
    tab.actions.close()
  }, [sessionId, tab, openInCenter])
  return null
}

function BackToEditor({ t, back }: { t: Translate; back: () => void }) {
  return (
    <button
      type="button"
      data-testid="dsh-editor-back"
      onClick={back}
      style={{ font: 'inherit', fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', color: 'inherit', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)' }}
    >
      {t('header.backToEditor')}
    </button>
  )
}

function mount(ctx: CordisContext, editor: EditorService): () => void {
  const slots = ctx.slots as Slots
  const tabs = ctx.sidebarRightTabs as { register(definition: object): () => void }
  const sidebar = ctx.sidebarRight as { openTab(kind: string): void }
  const sessions = ctx.sessions as Sessions
  const current = (ctx.uiSession as { adapter: { current: Observable<{ key: string | undefined }> } }).adapter.current
  const locale = ctx.locale as Locale
  const t = locale.bind(NS)
  const frameT = locale.bind(FRAME_NS)
  const disposers: (() => void)[] = []

  const workspaceRootOf = (sessionId: string | undefined): string | undefined =>
    sessionId === undefined ? undefined : sessions.list.getSnapshot().byId[sessionId]?.cwd
  const conversation = (sessionId: string): Conversation | undefined => sessions.scope(sessionId)?.get('conversation')

  // ---- centre, shown unless blank / no session / full conversation requested ----

  let mode: 'editor' | 'full' = 'editor'
  let disposeCenter: (() => void) | undefined
  let disposeBack: (() => void) | undefined

  const showFull = (): void => { mode = 'full'; syncCenter() }
  const back = (): void => { mode = 'editor'; syncCenter() }
  const openChat = (): void => sidebar.openTab(CHAT_KIND)
  const openFiles = (): void => sidebar.openTab(FILES_KIND)

  const registerCenter = (): (() => void) => slots.inject('main.conversation', () => slots.register(
    {
      name: 'main.conversation',
      priority: -100,
      locale: NS,
      inject: () => ({
        scopeKey: (sessionId: string | undefined, workspaceRoot: string | undefined) => editor.scopeKey(sessionId, workspaceRoot),
        ensureTabs: (key: string) => editor.viewState.ensureTabs(key),
        activateTab: (key: string, path: string) => editor.viewState.activateTab(key, path),
        closeTab: (key: string, path: string) => editor.viewState.closeTab(key, path),
        attach: (host: HTMLElement, sessionId: string, path: string, workspaceRoot: string | undefined) =>
          editor.attachFrame(host, { address: editor.addressFor(sessionId, path), workspaceRoot, t: frameT }),
        openFiles,
        openChat,
        showFull,
        hooks: { tabs: { getSnapshot: editor.viewState.getTabsSnapshot, subscribe: editor.viewState.subscribe } },
      }),
    },
    Center as (props: never) => unknown,
  ))

  const registerBack = (): (() => void) => slots.inject('conversation.session.header.actions', () => slots.register(
    { name: 'conversation.session.header.actions', id: 'dsh-editor-back', order: -100, inject: () => ({ back, t }) },
    BackToEditor as (props: never) => unknown,
  ))

  function syncCenter(): void {
    const key = current.getSnapshot().key
    const blank = key === undefined || (sessions.list.getSnapshot().byId[key]?.blank ?? true)
    const showEditor = mode === 'editor' && !blank
    if (showEditor && disposeCenter === undefined) disposeCenter = registerCenter()
    if (!showEditor && disposeCenter !== undefined) {
      disposeCenter()
      disposeCenter = undefined
    }
    const showBack = mode === 'full'
    if (showBack && disposeBack === undefined) disposeBack = registerBack()
    if (!showBack && disposeBack !== undefined) {
      disposeBack()
      disposeBack = undefined
    }
  }
  disposers.push(watch([current, sessions.list], syncCenter), () => {
    disposeCenter?.()
    disposeBack?.()
  })

  // ---- files from the sidebar open in the centre ----

  const openInCenter = (sessionId: string, address: string): void => {
    const file = editor.parseAddress(address)
    if (file === undefined) return
    const key = editor.scopeKey(sessionId, workspaceRootOf(sessionId))
    if (key === null) return
    editor.viewState.openTab(key, file.path)
    if (mode === 'full') back()
  }
  disposers.push(tabs.register({
    id: REDIRECT_ID,
    kind: REDIRECT_KIND,
    multiple: true,
    patterns: ['dsh-resource://file/**'],
    priority: 'extension',
    canOpen: (address: string) => {
      const file = editor.parseAddress(address)
      return file !== undefined && editor.engines.resolve(file.path) !== undefined
    },
    title: (address: string) => address.slice(address.lastIndexOf('/') + 1),
  }))
  disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: REDIRECT_ID, inject: () => ({ openInCenter }) },
    Redirect as (props: never) => unknown,
  )))
  // Editor tabs saved while layout A was active: hand them to the centre too.
  disposers.push(tabs.register({
    id: LEGACY_ID,
    kind: EDITOR_TAB_KIND,
    multiple: true,
    title: (address: string) => address.slice(address.lastIndexOf('/') + 1),
  }))
  disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: LEGACY_ID, inject: () => ({ openInCenter }) },
    Redirect as (props: never) => unknown,
  )))

  // ---- chat ----

  disposers.push(tabs.register({
    id: CHAT_ID,
    kind: CHAT_KIND,
    keepMounted: true,
    title: () => t('chat.title'),
    guide: [{ id: 'chat', order: -10, title: () => t('guide.chat'), description: () => t('guide.chatDescription') }],
  }))
  const renderMarkdown = (text: string): string => DOMPurify.sanitize(marked.parse(text, { async: false }))
  disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: CHAT_ID,
      locale: NS,
      inject: () => ({
        send: async (sessionId: string, text: string) => {
          // The AI reads files from disk: save what the editor shows first (design Q5).
          await editor.flushAll()
          await conversation(sessionId)?.send(text)
        },
        cancel: (sessionId: string) => { void conversation(sessionId)?.cancel().catch(() => {}) },
        removeContext: (sessionId: string) => editor.context.suppress(sessionId),
        effectiveContext: (snapshot: ContextSnapshot, sessionId: string) => effectiveContext(snapshot[sessionId]),
        showFull,
        renderMarkdown,
        hooks: { editorContext: { getSnapshot: editor.context.getSnapshot, subscribe: editor.context.subscribe } },
      }),
    },
    Chat as (props: never) => unknown,
  )))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  const locale = ctx.locale as Locale
  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-editor: layout B dictionaries')
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let disposeStyle: (() => void) | undefined
    const sync = (): void => {
      const active = editor.settings.getSnapshot()?.layout === 'main'
      if (active && dispose === undefined) {
        disposeStyle = ensureStyle()
        dispose = mount(ctx, editor)
      }
      if (!active && dispose !== undefined) {
        dispose()
        disposeStyle?.()
        dispose = disposeStyle = undefined
      }
    }
    const unsubscribe = editor.settings.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
      disposeStyle?.()
    }
  }, 'dsh-editor: layout B')
}
