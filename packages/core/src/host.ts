/**
 * Host half of @dsh-editor/core: the authenticated save route.
 *
 * The pattern is DSH's own open-in-app plugin: register a named route on
 * `ctx.webServer` and admit only requests `ctx.connection` accepts. Writes are
 * confined to the session's workspace and guarded by the version the editor
 * read, so a concurrent agent write turns into 409 instead of being overwritten.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { MAX_WRITE_BYTES, WRITE_ROUTE, type WriteRequest } from './write-route.ts'

export const name = 'dsh-editor-core'
export const inject = ['webServer', 'connection', 'fs', 'sessions', 'sandboxPolicy']

/**
 * Editor settings. Both are volatile, so rows on DSH's General settings page
 * edit them; the browser reads them through `configForms.get(<this entry's id>)`
 * and applies them on the next page load. Until `enabled` is set, DSH looks and behaves
 * exactly as without the editor.
 */
export interface Config {
  /** The editor fills the center and the AI chat moves to the right sidebar. */
  enabled: boolean
  /** Scope strategy id for editor view state: `workspace`, `session`, or one a project registered. */
  scope: string
}

export const Config = z.object({
  enabled: z.boolean().default(false)
    .description('Editor mode: the document in the center, the AI chat on the right. Off: DSH is unchanged. Takes effect after a reload.')
    .volatile(),
  scope: z.string().default('session')
    .description('Which sessions share open files and cursor positions: session (each separately) or workspace (all sessions in a workspace). Takes effect after a reload.')
    .volatile(),
})

// Host services, typed locally (see contract/dsh.ts for why).
interface FsTarget { readonly __target: unique symbol }
interface HostContext {
  effect(factory: () => () => void, label?: string): () => void
  get(name: string): unknown
  webServer: { register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void }
  connection: { requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined }
  fs: {
    resolve(path: string, options?: { cwd?: string }): Promise<FsTarget>
    contains(parent: FsTarget, child: FsTarget): boolean
    writeText(
      target: FsTarget,
      content: string,
      expected?: { kind: 'replaceIfVersion'; version: string },
      signal?: AbortSignal,
      sandboxPolicy?: { mode: 'workspace-write'; workspaceRoot: string; sessionId?: string },
    ): Promise<{ version: string }>
  }
  sessions: { get(sessionId: string): { header?: { cwd?: string } } | undefined }
  sandboxPolicy: { workspaceRoot: string }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_WRITE_BYTES) throw new HttpError(413, 'too-large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'bad-json')
  }
}

function parseRequest(value: unknown): WriteRequest {
  const v = value as Partial<Record<keyof WriteRequest, unknown>> | null
  if (
    typeof v !== 'object' || v === null
    || typeof v.sessionId !== 'string' || typeof v.path !== 'string' || typeof v.content !== 'string'
    || (v.version !== undefined && v.version !== null && typeof v.version !== 'string')
  ) {
    throw new HttpError(400, 'bad-request')
  }
  return { sessionId: v.sessionId, path: v.path, content: v.content, ...typeof v.version === 'string' ? { version: v.version } : {} }
}

/** The session's workspace root, live or persisted; mirrors workspaceFiles' own lookup. */
async function workspaceRootOf(ctx: HostContext, sessionId: string): Promise<string> {
  const live = ctx.sessions.get(sessionId)?.header
  const stored = live === undefined
    ? await (ctx.get('sessionPersistence') as { stat(id: string): Promise<{ header?: { cwd?: string } } | undefined> } | undefined)?.stat(sessionId)
    : undefined
  const header = live ?? stored?.header
  if (header === undefined) throw new HttpError(404, 'session-not-found')
  return header.cwd ?? ctx.sandboxPolicy.workspaceRoot
}

export function apply(ctx: HostContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WRITE_ROUTE,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        send(res, 405, { error: 'method-not-allowed' })
        return
      }
      try {
        const request = parseRequest(await readJson(req))
        const workspaceRoot = await workspaceRootOf(ctx, request.sessionId)
        const root = await ctx.fs.resolve(workspaceRoot)
        const target = await ctx.fs.resolve(request.path, { cwd: workspaceRoot })
        if (!ctx.fs.contains(root, target)) throw new HttpError(403, 'outside-workspace')
        const outcome = await ctx.fs.writeText(
          target,
          request.content,
          request.version === undefined ? undefined : { kind: 'replaceIfVersion', version: request.version },
          undefined,
          { mode: 'workspace-write', workspaceRoot, sessionId: request.sessionId },
        )
        send(res, 200, { version: outcome.version })
      } catch (error) {
        if (error instanceof HttpError) {
          send(res, error.status, { error: error.message })
          return
        }
        const code = (error as { code?: unknown } | null)?.code
        if (code === 'FS_STALE_VERSION') send(res, 409, { error: 'stale' })
        else send(res, 500, { error: typeof code === 'string' ? code : 'write-failed' })
      }
    },
  }), `dsh-editor: POST ${WRITE_ROUTE}`)
}
