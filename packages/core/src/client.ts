/**
 * Browser half of @dsh-editor/core: provides `ctx.editor` (an {@link EditorService}).
 * Other packages declare `inject: ['editor']` and import its types from
 * `@dsh-editor/core` with `import type` only.
 */
import type { CordisContext, WorkspaceFilesRemote } from './contract/dsh.ts'
import { DEFAULT_SETTINGS, EditorService, type EditorSettings } from './client/service.ts'
import { SettingsSection, type ConfigFormSnapshot } from './client/settings-section.tsx'
import { en, zh } from './client/locales.ts'

export const name = 'dsh-editor-core'
export const inject = ['remote', 'remote.workspaceFiles', 'locale', 'slots']

/** Profile entry id of the core row; settings are read from its config form. */
export const ENTRY_ID = 'dsh-editor-core'
/** Locale namespace of the editor frame and the settings page. */
export const NS = 'dshEditor'

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
  const locale = ctx.locale as {
    register(ns: string, dicts: Record<string, object>): () => void
    bind(ns: string): (key: string) => string
  }
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
    // The editor's own page in DSH's settings, while the host serves this entry's settings.
    const t = locale.bind(NS)
    ctx.effect(() => forms.whileServed([ENTRY_ID], () => slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: 'dsh-editor',
        order: 30,
        label: () => t('settings.nav'),
        locale: NS,
        inject: () => ({
          applied: service.settings.getSnapshot() ?? DEFAULT_SETTINGS,
          scopes: service.scopes.ids(),
          set: (field: keyof EditorSettings, value: string | boolean) => form.set(field, value).catch(() => false),
          hooks: { form },
        }),
      },
      SettingsSection as (props: never) => unknown,
    ))), 'dsh-editor: settings page')
  }

  ctx.effect(() => ctx.reflect.provide('editor', service), 'dsh-editor: editor service')
}
