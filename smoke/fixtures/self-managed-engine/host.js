// Host half of the smoke fixture: the engine saves through its own route,
// as a downstream project would (the template saves text only). Bytes in the
// body, workspace root and path in the query; confined to that root.
import { writeFile } from 'node:fs/promises'

export const name = 'dsh-editor-smoke-self-managed'
export const inject = ['webServer', 'connection', 'fs']
export const WRITE_ROUTE = '/dsh-editor-smoke/write'

export function apply(ctx) {
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
      try {
        const query = new URL(req.url ?? '', 'http://host').searchParams
        const root = await ctx.fs.resolve(query.get('root') ?? '')
        const target = await ctx.fs.resolve(query.get('path') ?? '', { cwd: query.get('root') ?? '' })
        if (req.method !== 'POST' || !ctx.fs.contains(root, target)) {
          res.statusCode = 400
          res.end()
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        await writeFile(ctx.fs.processPath(target), Buffer.concat(chunks))
        res.statusCode = 204
        res.end()
      } catch {
        res.statusCode = 500
        res.end()
      }
    },
  }), `dsh-editor smoke: POST ${WRITE_ROUTE}`)
}
