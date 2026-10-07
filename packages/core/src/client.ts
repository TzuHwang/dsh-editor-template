/**
 * Browser half of @dsh-editor/core: provides `ctx.editor` (an {@link EditorService}).
 * Other packages declare `inject: ['editor']` and import its types from
 * `@dsh-editor/core` with `import type` only.
 */
import type { CordisContext, WorkspaceFilesRemote } from './contract/dsh.ts'
import { EditorService } from './client/service.ts'

export const name = 'dsh-editor-core'
export const inject = ['remote', 'remote.workspaceFiles']

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    // Storage access can throw (blocked site data); run without persistence.
    return undefined
  }
}

export function apply(ctx: CordisContext): void {
  const remote = ctx.remote as { workspaceFiles: WorkspaceFilesRemote }
  const service = new EditorService(remote.workspaceFiles, browserStorage())
  ctx.effect(() => ctx.reflect.provide('editor', service), 'dsh-editor: editor service')
}
