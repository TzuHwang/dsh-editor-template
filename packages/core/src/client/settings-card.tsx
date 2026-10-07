/**
 * The editor's settings card on DSH's plugin page (design Q9): DSH renders no
 * form for volatile config by itself; a plugin contributes a card to the keyed
 * `plugins.bundle.config` slot under its bundle's package name. Writes go
 * through the entry's config form and apply on the next page load.
 */
import type { Translate } from './frame.ts'
import type { EditorSettings } from './service.ts'

export interface ConfigFormSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: Partial<EditorSettings> | undefined
}

interface SettingsCardProps {
  readonly t: Translate
  readonly useForm: <T>(selector: (snapshot: ConfigFormSnapshot) => T) => T
  /** Scope strategy ids to offer; projects may register more. */
  readonly scopes: readonly string[]
  readonly set: (field: keyof EditorSettings, value: string) => void
}

const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } as const
const select = {
  font: 'inherit', fontSize: 13, padding: '4px 6px', borderRadius: 6, color: 'inherit', background: 'transparent',
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', maxWidth: 320,
} as const

export function SettingsCard({ t, useForm, scopes, set }: SettingsCardProps) {
  const layout = useForm(snapshot => snapshot.value?.layout ?? 'tab')
  const scope = useForm(snapshot => snapshot.value?.scope ?? 'workspace')
  const ready = useForm(snapshot => snapshot.status === 'ready')
  const scopeLabel = (id: string): string =>
    id === 'workspace' || id === 'session' ? t(`settings.scope.${id}`) : id
  return (
    <div data-testid="dsh-editor-settings" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
      <label style={label}>
        {t('settings.layout')}
        <select data-testid="dsh-editor-settings-layout" style={select} disabled={!ready} value={layout} onChange={event => set('layout', event.target.value)}>
          <option value="tab">{t('settings.layout.tab')}</option>
          <option value="main">{t('settings.layout.main')}</option>
        </select>
      </label>
      <label style={label}>
        {t('settings.scope')}
        <select style={select} disabled={!ready} value={scope} onChange={event => set('scope', event.target.value)}>
          {(scopes.includes(scope) ? scopes : [...scopes, scope]).map(id => <option key={id} value={id}>{scopeLabel(id)}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.7 }}>
        <span>{t('settings.reload')}</span>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{ font: 'inherit', fontSize: 12, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', color: 'inherit', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)' }}
        >
          {t('settings.reloadNow')}
        </button>
      </div>
    </div>
  )
}
