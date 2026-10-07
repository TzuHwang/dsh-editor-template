/**
 * Host half of @dsh-editor/context (design Q6, M2).
 *
 * DSH 0.2 has no client hook to add data to an outgoing message, so the
 * browser mirrors each session's editor context here (CONTEXT_ROUTE) and an
 * `agent/pre-step` listener (the pattern of DSH's own time-context) appends it
 * as a sourced `snapshot` user message: only on a step a user message entered,
 * and only when it differs from the last one in the session's history. That
 * last one is a session projection folded from the durable log, so it
 * survives host restarts and resumes.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EditorContext } from '@dsh-editor/core'
import { CONTEXT_ROUTE, SOURCE_KIND, renderContext, type ContextRequest } from './render.ts'

export const name = 'dsh-editor-context'
export const inject = ['webServer', 'connection', 'agents', 'sessionProjections']

const PROJECTION_KEY = 'dshEditorContext'

/** Upper bound on one request: a path plus a bounded selection. */
const MAX_BODY_BYTES = 64 * 1024

// Host surfaces, typed locally (see @dsh-editor/core contract/dsh.ts).
interface UserMessage {
  readonly source: { readonly kind: string }
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}
type PreStepDecision =
  | { readonly kind: 'reject' }
  | { readonly kind: 'enter'; readonly messages: readonly UserMessage[] }
interface Session { readonly id: string }
/** Folded from the session log: the text of the latest editor context injected. */
interface ProjectionState { readonly lastText: string | null }
interface SessionEvent { readonly type: string; readonly data?: UserMessage }
interface HostContext {
  effect(factory: () => () => void, label?: string): () => void
  on(
    event: 'agent/pre-step',
    listener: (event: { agent: { session: Session }; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    options: { prepend: boolean },
  ): () => void
  sessionProjections: {
    register(definition: {
      key: string
      stateVersion: number
      stateSchema: { parse(value: unknown): ProjectionState }
      init(): ProjectionState
      apply(state: ProjectionState, event: SessionEvent): ProjectionState
    }): unknown
    stateOf(session: Session, key: string): ProjectionState
  }
  webServer: { register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void }
  connection: { requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * What DSH's `createUserMessage` (@deepseek-ai/dsh-llm) builds: a fresh id and a
 * frozen value. Built locally because this package does not resolve DSH's
 * modules at run time.
 */
function contextMessage(text: string): UserMessage {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
  })
}

function isContext(value: unknown): value is EditorContext {
  const v = value as Partial<EditorContext> | null
  if (typeof v !== 'object' || v === null || typeof v.path !== 'string' || typeof v.cursorLine !== 'number') return false
  const s = v.selection
  return s === undefined || (typeof s === 'object' && s !== null
    && typeof s.fromLine === 'number' && typeof s.toLine === 'number'
    && typeof s.text === 'string' && typeof s.truncated === 'boolean')
}

async function readRequest(req: IncomingMessage): Promise<ContextRequest | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<ContextRequest>
    if (typeof value.sessionId !== 'string') return undefined
    if (value.context !== null && !isContext(value.context)) return undefined
    return { sessionId: value.sessionId, context: value.context }
  } catch {
    return undefined
  }
}

/** DSH only calls `parse` on a projection's state schema. */
const projectionSchema = {
  parse(value: unknown): ProjectionState {
    const lastText = (value as { lastText?: unknown } | null)?.lastText
    if (lastText !== null && typeof lastText !== 'string') throw new TypeError('dshEditorContext: invalid projection state')
    return { lastText }
  },
}

const textOf = (message: UserMessage): string =>
  (message.content ?? []).map(part => part.text ?? '').join('')

export function apply(ctx: HostContext): void {
  const current = new Map<string, EditorContext>()

  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: projectionSchema,
    init: () => ({ lastText: null }),
    apply: (state, event) => event.type === 'user/message' && event.data?.source.kind === SOURCE_KIND
      ? { lastText: textOf(event.data) }
      : state,
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONTEXT_ROUTE,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const request = await readRequest(req)
      if (request === undefined) {
        res.statusCode = 400
        res.end()
        return
      }
      if (request.context === null) {
        current.delete(request.sessionId)
      } else {
        current.set(request.sessionId, request.context)
      }
      res.statusCode = 204
      res.end()
    },
  }), `dsh-editor: POST ${CONTEXT_ROUTE}`)

  ctx.effect(() => ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // Only a step the user's own message enters; not tool follow-ups or scheduled turns.
    if (!decision.messages.some(message => message.source.kind === 'user')) return decision
    const context = current.get(agent.session.id)
    if (context === undefined) return decision
    const text = renderContext(context)
    // The model already has this exact snapshot as its latest editor context.
    if (ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY).lastText === text) return decision
    return { ...decision, messages: [...decision.messages, contextMessage(text)] }
  }, { prepend: true }), 'dsh-editor: inject editor context')
}
