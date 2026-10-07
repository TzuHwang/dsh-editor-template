/**
 * Browser half of @dsh-editor/core: provides `ctx.editor` (an {@link EditorService}).
 * Other packages declare `inject: ['editor']` and import its types from
 * `@dsh-editor/core` with `import type` only.
 */
import type { CordisContext, WorkspaceFilesRemote } from './contract/dsh.ts'
import { DEFAULT_SETTINGS, EditorService, type EditorSettings } from './client/service.ts'
import { en, zh } from './client/locales.ts'

export const name = 'dsh-editor-core'
export const inject = ['remote', 'remote.workspaceFiles', 'locale']

/** Profile entry id of the core row; settings are read from its config form. */
export const ENTRY_ID = 'dsh-editor-core'
/** Locale namespace of the editor frame. */
export const NS = 'dshEditor'

interface ConfigForms {
  get(id: string): {
    getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: Partial<EditorSettings> | undefined }
    subscribe(listener: () => void): () => void
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    // Storage access can throw (blocked site data); run without persistence.
    return undefined
  }
}

/** Read the settings once DSH answers; they apply until the next page load (design Q9). */
function readSettings(ctx: CordisContext, service: EditorService): () => void {
  const forms = ctx.get('configForms') as ConfigForms | undefined
  if (forms === undefined) {
    service.applySettings(DEFAULT_SETTINGS)
    return () => {}
  }
  const form = forms.get(ENTRY_ID)
  let settled = false
  const sync = (): void => {
    if (settled) return
    const snapshot = form.getSnapshot()
    if (snapshot.status === 'loading') return
    settled = true
    const value = snapshot.value ?? {}
    service.applySettings({
      layout: value.layout === 'main' ? 'main' : 'tab',
      scope: typeof value.scope === 'string' && value.scope !== '' ? value.scope : DEFAULT_SETTINGS.scope,
    })
  }
  const unsubscribe = form.subscribe(sync)
  sync()
  return unsubscribe
}

export function apply(ctx: CordisContext): void {
  const remote = ctx.remote as { workspaceFiles: WorkspaceFilesRemote }
  const locale = ctx.locale as { register(ns: string, dicts: Record<string, object>): () => void }
  const service = new EditorService(remote.workspaceFiles, browserStorage())
  ctx.effect(() => locale.register(NS, { zh, en }), 'dsh-editor: dictionaries')
  ctx.effect(() => readSettings(ctx, service), 'dsh-editor: settings')
  ctx.effect(() => ctx.reflect.provide('editor', service), 'dsh-editor: editor service')
}
