/**
 * Browser half of @dsh-editor/core: provides `ctx.editor` (an {@link EditorService}).
 * Other packages declare `inject: ['editor']` and import its types from
 * `@dsh-editor/core` with `import type` only.
 */
import type { CordisContext, WorkspaceFilesRemote } from './contract/dsh.ts'
import { DEFAULT_SETTINGS, EditorService, type EditorSettings } from './client/service.ts'
import { SettingsCard, type ConfigFormSnapshot } from './client/settings-card.tsx'
import { en, zh } from './client/locales.ts'

export const name = 'dsh-editor-core'
export const inject = ['remote', 'remote.workspaceFiles', 'locale', 'slots']

/** Profile entry id of the core row; settings are read from its config form. */
export const ENTRY_ID = 'dsh-editor-core'
/** Locale namespace of the editor frame and the settings card. */
export const NS = 'dshEditor'
/** The template's own bundle; projects with their own bundle call `editor.registerSettingsCard`. */
const TEMPLATE_BUNDLE = '@dsh-editor/bundle'

interface ConfigForm {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}
interface ConfigForms {
  get(id: string): ConfigForm
  whileServed(namespaces: readonly string[], register: () => () => void): () => void
}
interface Slots {
  inject(name: string, callback: () => () => void): () => void
  register(options: object, component: (props: never) => unknown): () => void
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
function readSettings(form: ConfigForm, service: EditorService): () => void {
  let settled = false
  const sync = (): void => {
    if (settled) return
    const snapshot = form.getSnapshot()
    if (snapshot.status === 'loading') return
    settled = true
    const value = snapshot.value ?? {}
    service.applySettings({
      enabled: value.enabled === true,
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

  const forms = ctx.get('configForms') as ConfigForms | undefined
  if (forms === undefined) {
    // No settings service in this composition: defaults.
    service.applySettings(DEFAULT_SETTINGS)
  } else {
    const form = forms.get(ENTRY_ID)
    const slots = ctx.slots as Slots
    ctx.effect(() => readSettings(form, service), 'dsh-editor: settings')
    service.registerSettingsCard = bundleName => forms.whileServed([ENTRY_ID], () => slots.inject('plugins.bundle.config', () => slots.register(
      {
        name: 'plugins.bundle.config',
        key: bundleName,
        locale: NS,
        inject: () => ({
          scopes: service.scopes.ids(),
          set: (field: keyof EditorSettings, value: string) => { void form.set(field, value) },
          hooks: { form },
        }),
      },
      SettingsCard as (props: never) => unknown,
    )))
    ctx.effect(() => service.registerSettingsCard(TEMPLATE_BUNDLE), 'dsh-editor: settings card')
  }

  ctx.effect(() => ctx.reflect.provide('editor', service), 'dsh-editor: editor service')
}
