/**
 * The right-sidebar chat beside the centre editor: a compact conversation
 * built on DSH's public session hooks. Official components cannot be rendered
 * outside `main.conversation`, so this draws its own; "full conversation"
 * shows DSH's for tool details.
 *
 * Covers: streamed answers (Markdown), one-line tool calls, errors, approval
 * and question prompts (without them a waiting agent would hang), the editor
 * context chip, send and stop.
 */
import type { ContextSnapshot, EditorContext, Translate } from '@dsh-editor/core'
import { useEffect, useMemo, useRef, useState } from 'react'

// ---- DSH shapes, typed locally (see @dsh-editor/core contract/dsh.ts) ----

type AssistantBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-call'; callId: string; name: string }
  | { kind: string }

type ConversationNode =
  | { kind: 'user'; seq: number; content: readonly { type: string; text?: string }[] }
  | { kind: 'assistant'; seq: number; blocks: readonly AssistantBlock[] }
  | { kind: 'tool-result'; seq: number; callId: string; name: string }
  | { kind: 'turn-error'; seq: number; message: string }
  | { kind: string; seq: number }

interface LegacySlice {
  readonly nodes: readonly ConversationNode[]
  readonly partial: { readonly blocks: readonly AssistantBlock[] } | null
  readonly runningCalls: readonly { readonly callId: string; readonly name?: string }[]
}

interface PendingApproval {
  readonly kind: 'approval'
  readonly key: string
  readonly toolName: string
  readonly reason?: string
  answer(outcome: 'allowed-once' | 'rejected'): Promise<void>
}

interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
}

interface PendingQuestion {
  readonly kind: 'question' | 'plan-review'
  readonly key: string
  readonly questions: readonly QuestionItem[]
  answer(answer: { answers: { id: string; selected: string[]; custom?: string }[] }): Promise<void>
}

type Pending = PendingApproval | PendingQuestion | { readonly kind: string; readonly key: string }

export interface ChatProps {
  readonly sessionId: string
  readonly t: Translate
  readonly useChat: <T>(selector: (snapshot: { legacy: LegacySlice }) => T) => T
  readonly useSession: <T>(selector: (snapshot: { running: boolean }) => T) => T
  readonly useSessionStatus: <T>(selector: (snapshot: ReadonlyMap<string, { pendingInteraction?: Pending }>) => T) => T
  readonly useEditorContext: <T>(selector: (snapshot: ContextSnapshot) => T) => T
  readonly effectiveContext: (snapshot: ContextSnapshot, sessionId: string) => EditorContext | undefined
  readonly send: (sessionId: string, text: string) => Promise<void>
  readonly cancel: (sessionId: string) => void
  readonly removeContext: (sessionId: string) => void
  readonly showFull: () => void
  readonly renderMarkdown: (text: string) => string
}

// ---- styles ----

const muted = { opacity: 0.6, fontSize: 12 } as const
const button = {
  font: 'inherit', fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', color: 'inherit',
  background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
} as const
const primary = { ...button, background: 'color-mix(in srgb, currentColor 12%, transparent)' } as const
const card = {
  margin: '8px 12px', padding: 10, borderRadius: 8, fontSize: 13,
  border: '1px solid color-mix(in srgb, #f5a623 45%, transparent)',
  background: 'color-mix(in srgb, #f5a623 8%, transparent)',
} as const

function contextLabel(context: EditorContext, t: Translate): string {
  const name = context.path.slice(context.path.lastIndexOf('/') + 1)
  const s = context.selection
  if (s === undefined) return `${name}:${context.cursorLine}`
  const range = s.fromLine === s.toLine ? `${s.fromLine}` : `${s.fromLine}-${s.toLine}`
  return `${name}:${range} · ${t('chat.selected')}`
}

// ---- message list ----

function Markdown({ text, render }: { text: string; render: (text: string) => string }) {
  const html = useMemo(() => render(text), [text, render])
  return <div className="dsh-chat-md" dangerouslySetInnerHTML={{ __html: html }} />
}

function Blocks({ blocks, done, running, props }: {
  blocks: readonly AssistantBlock[]
  done: ReadonlySet<string>
  running: ReadonlySet<string>
  props: ChatProps
}) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === 'text' && 'text' in block) return <Markdown key={index} text={block.text} render={props.renderMarkdown} />
        if (block.kind === 'reasoning' && 'text' in block && block.text.trim() !== '') {
          return (
            <details key={index} style={{ ...muted, margin: '4px 0' }}>
              <summary style={{ cursor: 'pointer' }}>{props.t('chat.reasoning')}</summary>
              <div style={{ whiteSpace: 'pre-wrap' }}>{block.text}</div>
            </details>
          )
        }
        if (block.kind === 'tool-call' && 'callId' in block) {
          const mark = done.has(block.callId) ? '✓' : running.has(block.callId) ? '…' : '•'
          return <div key={index} data-testid="dsh-chat-tool" style={{ ...muted, fontFamily: 'ui-monospace, monospace' }}>{mark} {block.name}</div>
        }
        return null
      })}
    </>
  )
}

function Messages({ props }: { props: ChatProps }) {
  const slice = props.useChat(snapshot => snapshot.legacy)
  const end = useRef<HTMLDivElement>(null)
  const done = useMemo(() => new Set(slice.nodes.flatMap(node => node.kind === 'tool-result' && 'callId' in node ? [node.callId] : [])), [slice.nodes])
  const running = useMemo(() => new Set(slice.runningCalls.map(call => call.callId)), [slice.runningCalls])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [slice])

  const visible = slice.nodes.filter(node => node.kind === 'user' || node.kind === 'assistant' || node.kind === 'turn-error')
  if (visible.length === 0 && slice.partial === null) {
    return <div style={{ ...muted, padding: 16 }}>{props.t('chat.empty')}</div>
  }
  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {visible.map(node => {
        if (node.kind === 'user' && 'content' in node) {
          const text = node.content.map(part => part.text ?? '').join('')
          return (
            <div key={node.seq} data-testid="dsh-chat-user" style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '6px 10px', borderRadius: 10, whiteSpace: 'pre-wrap', background: 'color-mix(in srgb, currentColor 8%, transparent)' }}>
              {text}
            </div>
          )
        }
        if (node.kind === 'assistant' && 'blocks' in node) {
          return <div key={node.seq} data-testid="dsh-chat-assistant"><Blocks blocks={node.blocks} done={done} running={running} props={props} /></div>
        }
        if (node.kind === 'turn-error' && 'message' in node) {
          return <div key={node.seq} style={{ color: '#d0453d', fontSize: 12 }}>{node.message}</div>
        }
        return null
      })}
      {slice.partial !== null && (
        <div data-testid="dsh-chat-partial"><Blocks blocks={slice.partial.blocks} done={done} running={running} props={props} /></div>
      )}
      <div ref={end} />
    </div>
  )
}

// ---- pending interactions ----

function Approval({ pending, t }: { pending: PendingApproval; t: Translate }) {
  return (
    <div style={card} data-testid="dsh-chat-approval">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('approval.title', { tool: pending.toolName })}</div>
      {pending.reason !== undefined && <div style={{ ...muted, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{pending.reason}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={primary} onClick={() => void pending.answer('allowed-once')}>{t('approval.allow')}</button>
        <button type="button" style={button} onClick={() => void pending.answer('rejected')}>{t('approval.reject')}</button>
      </div>
    </div>
  )
}

function Question({ pending, t }: { pending: PendingQuestion; t: Translate }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const toggle = (item: QuestionItem, label: string): void => {
    setSelected(current => {
      const chosen = current[item.id] ?? []
      const next = chosen.includes(label)
        ? chosen.filter(value => value !== label)
        : item.multiSelect === true ? [...chosen, label] : [label]
      return { ...current, [item.id]: next }
    })
  }
  const submit = (): void => {
    void pending.answer({
      answers: pending.questions.map(item => ({
        id: item.id,
        selected: selected[item.id] ?? [],
        ...(custom[item.id] ?? '').trim() === '' ? {} : { custom: custom[item.id]!.trim() },
      })),
    })
  }
  return (
    <div style={card} data-testid="dsh-chat-question">
      {pending.questions.map(item => (
        <div key={item.id} style={{ marginBottom: 10 }}>
          {item.header !== undefined && <div style={muted}>{item.header}</div>}
          <div style={{ fontWeight: 600 }}>{item.question}</div>
          {item.detail !== undefined && <div style={{ ...muted, whiteSpace: 'pre-wrap' }}>{item.detail}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
            {(item.options ?? []).map(option => (
              <button
                key={option.label}
                type="button"
                title={option.description}
                style={(selected[item.id] ?? []).includes(option.label) ? primary : button}
                onClick={() => toggle(item, option.label)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            placeholder={t('question.custom')}
            value={custom[item.id] ?? ''}
            onChange={event => setCustom(current => ({ ...current, [item.id]: event.target.value }))}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', background: 'transparent', color: 'inherit' }}
          />
        </div>
      ))}
      <button type="button" style={primary} onClick={submit}>{t('question.submit')}</button>
    </div>
  )
}

function PendingPanel({ props }: { props: ChatProps }) {
  const pending = props.useSessionStatus(snapshot => snapshot.get(props.sessionId)?.pendingInteraction)
  if (pending === undefined) return null
  if (pending.kind === 'approval') return <Approval key={pending.key} pending={pending as PendingApproval} t={props.t} />
  if (pending.kind === 'question' || pending.kind === 'plan-review') {
    return <Question key={pending.key} pending={pending as PendingQuestion} t={props.t} />
  }
  return null
}

// ---- composer ----

function Composer({ props }: { props: ChatProps }) {
  const { sessionId, t } = props
  const [draft, setDraft] = useState('')
  const running = props.useSession(snapshot => snapshot.running)
  const context = props.useEditorContext(snapshot => props.effectiveContext(snapshot, sessionId))
  const submit = (): void => {
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    void props.send(sessionId, text)
  }
  return (
    <div style={{ padding: '8px 12px 12px', borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' }}>
      {context !== undefined && (
        <div data-testid="dsh-chat-context" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 4px 2px 8px', marginBottom: 6, borderRadius: 6, border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}>
          <span aria-hidden>📄</span>
          <span>{contextLabel(context, t)}</span>
          <button type="button" aria-label={t('chat.removeContext')} style={{ ...button, border: 'none', padding: '0 4px' }} onClick={() => props.removeContext(sessionId)}>✕</button>
        </div>
      )}
      <textarea
        data-testid="dsh-chat-input"
        value={draft}
        rows={3}
        placeholder={t('chat.placeholder')}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', background: 'transparent', color: 'inherit' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <button type="button" style={button} onClick={props.showFull}>{t('chat.full')}</button>
        {running
          ? <button type="button" data-testid="dsh-chat-stop" style={button} onClick={() => props.cancel(sessionId)}>{t('chat.stop')}</button>
          : <button type="button" data-testid="dsh-chat-send" style={primary} disabled={draft.trim() === ''} onClick={submit}>{t('chat.send')}</button>}
      </div>
    </div>
  )
}

export function Chat(props: ChatProps) {
  return (
    <div data-testid="dsh-chat" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Messages props={props} />
      </div>
      <PendingPanel props={props} />
      <Composer props={props} />
    </div>
  )
}

/** Styles for rendered Markdown in chat answers. */
export const CHAT_STYLE = `
.dsh-chat-md { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.dsh-chat-md > :first-child { margin-top: 0; }
.dsh-chat-md > :last-child { margin-bottom: 0; }
.dsh-chat-md pre { overflow: auto; padding: 8px; border-radius: 6px; background: color-mix(in srgb, currentColor 6%, transparent); }
.dsh-chat-md code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
`
