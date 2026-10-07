/**
 * Browser half of @dsh-editor/context: mirrors `editor.context` to the host
 * and shows the removable chip above the composer (design Q6).
 */
import type { ContextSnapshot, CordisContext, EditorContext, EditorService } from '@dsh-editor/core'
import { contextKey, effectiveContext } from '@dsh-editor/core/context'
import { CONTEXT_ROUTE, type ContextRequest } from './render.ts'
import { en, zh } from './locales.ts'

export const name = 'dsh-editor-context'
export const inject = ['editor', 'slots', 'locale']

const NS = 'dshEditorContext'
/** Debounce for mirroring; short, so a selection made just before sending is current. */
const SYNC_MS = 150

interface Slots {
  inject(name: string, callback: () => () => void): () => void
  register(options: object, component: (props: never) => unknown): () => void
}

type Translate = (key: string, params?: Record<string, string>) => string

interface ChipProps {
  readonly sessionId: string
  readonly useEditorContext: <T>(selector: (snapshot: ContextSnapshot) => T) => T
  readonly remove: (sessionId: string) => void
  readonly t: Translate
}

function label(context: EditorContext): string {
  const name = context.path.slice(context.path.lastIndexOf('/') + 1)
  const s = context.selection
  if (s === undefined) return `${name}:${context.cursorLine}`
  return s.fromLine === s.toLine ? `${name}:${s.fromLine}` : `${name}:${s.fromLine}-${s.toLine}`
}

function ContextChip({ sessionId, useEditorContext, remove, t }: ChipProps) {
  const context = useEditorContext(snapshot => effectiveContext(snapshot[sessionId]))
  if (context === undefined) return null
  return (
    <div data-testid="dsh-editor-context-chip" style={{ display: 'flex', padding: '0 4px 6px' }}>
      <span
        title={t('chip.title')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
          fontSize: 12, padding: '2px 4px 2px 8px', borderRadius: 6,
          border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
          background: 'color-mix(in srgb, currentColor 4%, transparent)',
        }}
      >
        <span aria-hidden>📄</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label(context)}{context.selection === undefined ? '' : ` · ${t('chip.selected')}`}
        </span>
        <button
          type="button"
          aria-label={t('chip.remove')}
          onClick={() => remove(sessionId)}
          style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '0 4px', opacity: 0.6 }}
        >
          ✕
        </button>
      </span>
    </div>
  )
}

/** Push each session's effective context to the host whenever it changes. */
function mirror(store: EditorService['context']): () => void {
  const sent = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const send = (sessionId: string, context: EditorContext | undefined): void => {
    const key = context === undefined ? '' : contextKey(context)
    if ((sent.get(sessionId) ?? '') === key) return
    sent.set(sessionId, key)
    const body: ContextRequest = { sessionId, context: context ?? null }
    void fetch(CONTEXT_ROUTE.slice(1), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Lost update: forget it so the next change resends.
      sent.delete(sessionId)
    })
  }

  const sync = (): void => {
    const snapshot = store.getSnapshot()
    const sessions = new Set([...sent.keys(), ...Object.keys(snapshot)])
    for (const sessionId of sessions) {
      clearTimeout(timers.get(sessionId))
      timers.set(sessionId, setTimeout(() => {
        timers.delete(sessionId)
        send(sessionId, effectiveContext(store.getSnapshot()[sessionId]))
      }, SYNC_MS))
    }
  }

  const unsubscribe = store.subscribe(sync)
  return () => {
    unsubscribe()
    for (const timer of timers.values()) clearTimeout(timer)
  }
}

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  const slots = ctx.slots as Slots
  const locale = ctx.locale as { register(ns: string, dicts: Record<string, object>): () => void }

  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-editor: context dictionaries')
  ctx.effect(() => mirror(editor.context), 'dsh-editor: mirror context to host')

  const source = { getSnapshot: editor.context.getSnapshot, subscribe: editor.context.subscribe }
  const remove = (sessionId: string): void => editor.context.suppress(sessionId)
  ctx.effect(() => slots.inject('conversation.input.dock', () => slots.register(
    {
      name: 'conversation.input.dock',
      id: 'dsh-editor-context',
      order: 50,
      locale: NS,
      inject: () => ({ remove, hooks: { editorContext: source } }),
    },
    ContextChip as (props: never) => unknown,
  )), 'dsh-editor: context chip')
}
