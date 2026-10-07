/**
 * The editor layout: the document fills the center, the AI chat is a
 * right-sidebar tab. Active only while the `enabled` setting is on; when off,
 * DSH is unchanged.
 *
 * - Center: occupies `main.conversation` with a shadowing registration (a
 *   `single` slot is a documented replacement point), so it gets the selected
 *   session, a new one included; the chat opens beside it on first show. The
 *   registration is withdrawn, showing DSH's own screen, while no session is
 *   selected and while the user asked for the full conversation (which is also
 *   where DSH's start screen picks a new session's workspace).
 * - Files opened from the sidebar land in the center: a redirect tab type
 *   outranks DSH's viewers, hands the file to the center and closes itself.
 * - Chat: see chat.tsx.
 */
import type { ContextSnapshot, CordisContext, EditorService, Translate } from '@dsh-editor/core'
import { effectiveContext } from '@dsh-editor/core/context'
import { CHAT_TAB_KIND as CHAT_KIND, LEGACY_EDITOR_TAB_KIND, REDIRECT_TAB_KIND as REDIRECT_KIND } from '@dsh-editor/core/kinds'
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
const RETIRE_ID = '@dsh-editor/layout-main/retired'
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

/** Body of the redirect tab: hand the file to the center, then close. */
function Redirect({ sessionId, useTabInfo, openInCenter }: RedirectProps) {
  const { tab } = useTabInfo()
  useEffect(() => {
    openInCenter(sessionId, tab.contentId)
    tab.actions.close()
  }, [sessionId, tab, openInCenter])
  return null
}

/**
 * A floating button over DSH's own screen. It sits in the frame-wide overlay
 * rather than a conversation header, because a new session's start screen has
 * no header. The overlay layer is click-through; the button opts back in.
 */
function BackToEditor({ t, back }: { t: Translate; back: () => void }) {
  return (
    <button
      type="button"
      data-testid="dsh-editor-back"
      onClick={back}
      style={{
        position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, pointerEvents: 'auto',
        font: 'inherit', fontSize: 12, padding: '5px 14px', borderRadius: 999, cursor: 'pointer',
        color: 'inherit', background: 'var(--dsw-alias-bg-l1, Canvas)', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      }}
    >
      ← {t('header.backToEditor')}
    </button>
  )
}

function mount(ctx: CordisContext, editor: EditorService): () => void {
  const slots = ctx.slots as Slots
  const tabs = ctx.sidebarRightTabs as { register(definition: object): () => void }
  const sidebar = ctx.sidebarRight as { openTab(kind: string): void; isExpanded(): boolean }
  const sessions = ctx.sessions as Sessions
  const current = (ctx.uiSession as { adapter: { current: Observable<{ key: string | undefined }> } }).adapter.current
  const locale = ctx.locale as Locale
  const t = locale.bind(NS)
  const frameT = locale.bind(FRAME_NS)
  const disposers: (() => void)[] = []

  const workspaceRootOf = (sessionId: string | undefined): string | undefined =>
    sessionId === undefined ? undefined : sessions.list.getSnapshot().byId[sessionId]?.cwd
  const conversation = (sessionId: string): Conversation | undefined => sessions.scope(sessionId)?.get('conversation')

  // ---- center, shown unless blank / no session / full conversation requested ----

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

  const registerBack = (): (() => void) => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'dsh-editor-back', inject: () => ({ back, t }) },
    BackToEditor as (props: never) => unknown,
  ))

  /** The session the editor last showed for; the chat is ensured once per arrival. */
  let shownFor: string | undefined

  /**
   * The chat belongs beside the editor: when the editor shows for a session
   * (switching sessions, back from the full conversation) and that session's
   * sidebar is collapsed, open it on the chat. An expanded sidebar is left as
   * the user arranged it.
   */
  const ensureChat = (): void => {
    // After the commit that mounts the session's sidebar seat.
    setTimeout(() => {
      try {
        if (!sidebar.isExpanded()) openChat()
      } catch {
        // No session on screen yet; the "AI chat" button stays available.
      }
    }, 0)
  }

  function syncCenter(): void {
    const key = current.getSnapshot().key
    // Any selected session, a new one included, gets the editor; DSH's own screen
    // (start screen, workspace picker) stays one click away under "full conversation".
    const showEditor = mode === 'editor' && key !== undefined
    if (showEditor && disposeCenter === undefined) disposeCenter = registerCenter()
    if (showEditor && key !== shownFor) ensureChat()
    shownFor = showEditor ? key : undefined
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

  // ---- files from the sidebar open in the center ----

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

/** Body for an editor tab left in the sidebar after the editor was turned off: close it. */
function Retire({ useTabInfo }: { useTabInfo: () => { readonly tab: { readonly actions: { close(): void } } } }) {
  const { tab } = useTabInfo()
  useEffect(() => { tab.actions.close() }, [tab])
  return null
}

/** While the editor is off, its persisted tabs only close themselves; nothing else of DSH changes. */
function retire(ctx: CordisContext, kinds: readonly string[]): () => void {
  const slots = ctx.slots as Slots
  const tabs = ctx.sidebarRightTabs as { register(definition: object): () => void }
  return combine(kinds.flatMap((kind) => {
    const id = `${RETIRE_ID}/${kind}`
    return [
      tabs.register({ id, kind, multiple: true, title: (address: string) => address.slice(address.lastIndexOf('/') + 1) }),
      slots.inject('sidebar.right.pane.tab', () => slots.register(
        { name: 'sidebar.right.pane.tab', key: id },
        Retire as (props: never) => unknown,
      )),
    ]
  }))
}

function combine(disposers: readonly (() => void)[]): () => void {
  return () => { for (const dispose of [...disposers].reverse()) dispose() }
}

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  const locale = ctx.locale as Locale
  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-editor: layout dictionaries')
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let state: 'on' | 'off' | undefined
    const sync = (): void => {
      const settings = editor.settings.getSnapshot()
      if (settings === undefined) return
      const next = settings.enabled ? 'on' : 'off'
      if (next === state) return
      dispose?.()
      state = next
      if (next === 'on') {
        const disposeStyle = ensureStyle()
        const disposeMount = mount(ctx, editor)
        dispose = combine([disposeStyle, disposeMount, retire(ctx, [LEGACY_EDITOR_TAB_KIND])])
      } else {
        dispose = retire(ctx, [CHAT_KIND, REDIRECT_KIND, LEGACY_EDITOR_TAB_KIND])
      }
    }
    const unsubscribe = editor.settings.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
    }
  }, 'dsh-editor: layout')
}
