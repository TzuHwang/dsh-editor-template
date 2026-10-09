/**
 * The editor's own page in DSH's settings (the `settings.section` slot), laid
 * out like DSH's pages. Values are the core entry's volatile config, written
 * through its config form, and apply on the next page load: turning editor
 * mode on or off saves and reloads at once; other changes offer a reload.
 */
import { IconChevronDownOutlineRegular, Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from './frame.ts'
import type { EditorSettings } from './service.ts'

export interface ConfigFormSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: Partial<EditorSettings> | undefined
}

export interface SettingsSectionProps {
  readonly t: Translate
  readonly useForm: <T>(selector: (snapshot: ConfigFormSnapshot) => T) => T
  /** The settings this page load runs with. */
  readonly applied: EditorSettings
  /** Scope strategy ids to offer; projects may register more. */
  readonly scopes: readonly string[]
  /** Save one setting; resolves whether it was stored. */
  readonly set: (field: keyof EditorSettings, value: string | boolean) => Promise<boolean>
}

// DSH's own settings look, on DSH's theme variables.
const page = { display: 'flex', flexDirection: 'column', width: '100%' } as const
const heading = { fontSize: 18, fontWeight: 600, lineHeight: '26px', color: 'var(--dsw-alias-label-primary)' } as const
const intro = { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)', margin: '4px 0 8px' } as const
const row = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0',
  borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
} as const
const rowText = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48 } as const
const title = { fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } as const
const desc = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' } as const
const pill = {
  display: 'inline-flex', alignItems: 'center', gap: 12, height: 36, padding: '0 14px', border: 'none',
  borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-module-platform)', font: 'inherit',
  fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
} as const
const primary = {
  ...pill, gap: 0, minWidth: 72, justifyContent: 'center',
  background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-l1, #fff)',
} as const
const link = {
  border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)', textDecoration: 'underline',
} as const

function Row({ name, description, children }: { name: string; description: ReactNode; children: ReactNode }) {
  return (
    <div style={row}>
      <div style={rowText}>
        <div style={title}>{name}</div>
        <div style={desc}>{description}</div>
      </div>
      {children}
    </div>
  )
}

/** On/off as one button: saving it reloads the page, which applies it. */
function EnabledRow({ t, useForm, applied, set }: SettingsSectionProps) {
  const ready = useForm(snapshot => snapshot.status === 'ready')
  const [state, setState] = useState<'idle' | 'applying' | 'failed'>('idle')
  const toggle = async (): Promise<void> => {
    setState('applying')
    if (await set('enabled', !applied.enabled)) location.reload()
    else setState('failed')
  }
  const status = state === 'failed' ? t('settings.applyFailed') : t(applied.enabled ? 'settings.enabled.on' : 'settings.enabled.off')
  return (
    <Row name={t('settings.enabled')} description={status}>
      <button
        type="button"
        data-testid="dsh-editor-settings-toggle"
        style={applied.enabled ? pill : primary}
        disabled={!ready || state === 'applying'}
        onClick={() => { void toggle() }}
      >
        {state === 'applying' ? t('settings.applying') : t(applied.enabled ? 'settings.disable' : 'settings.enable')}
      </button>
    </Row>
  )
}

function ScopeRow({ t, useForm, applied, scopes, set }: SettingsSectionProps) {
  const ready = useForm(snapshot => snapshot.status === 'ready')
  const saved = useForm(snapshot => snapshot.value?.scope ?? applied.scope)
  // The form answers after the write round-trips; show the choice at once.
  const [pending, setPending] = useState<string | undefined>(undefined)
  useEffect(() => { if (pending === saved) setPending(undefined) }, [pending, saved])
  const scope = pending ?? saved
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const label = (id: string): string => id === 'workspace' || id === 'session' ? t(`settings.scope.${id}`) : id
  const ids = scopes.includes(scope) ? scopes : [...scopes, scope]
  return (
    <Row name={t('settings.scope')} description={reloadNote(t, t('settings.scope.hint'), scope !== applied.scope)}>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={ids.map(id => ({ id, label: label(id) }))}
        selectedId={scope}
        onSelect={(id) => {
          anchorRef.current?.focus({ preventScroll: true })
          setOpen(false)
          setPending(id)
          void set('scope', id)
        }}
        align="end"
        portal
        anchor={(
          <button
            ref={anchorRef}
            type="button"
            data-testid="dsh-editor-settings-scope"
            style={pill}
            disabled={!ready}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          >
            {label(scope)}
            <IconChevronDownOutlineRegular style={{ flex: 'none' }} />
          </button>
        )}
      />
    </Row>
  )
}

/** A row's hint, then a line saying it applies after a reload, or a reload link once it changed. */
function reloadNote(t: Translate, hint: string, changed: boolean): ReactNode {
  // One sentence per line: no joining space to get wrong between languages.
  return (
    <>
      <span style={{ display: 'block' }}>{hint}</span>
      <span style={{ display: 'block' }}>
        {changed
          ? <button type="button" style={link} onClick={() => location.reload()}>{t('settings.reloadNow')}</button>
          : t('settings.reload')}
      </span>
    </>
  )
}

function KeepTabsRow({ t, useForm, applied, set }: SettingsSectionProps) {
  const ready = useForm(snapshot => snapshot.status === 'ready')
  const saved = useForm(snapshot => snapshot.value?.keepTabs ?? applied.keepTabs)
  // The form answers after the write round-trips; show the choice at once.
  const [pending, setPending] = useState<boolean | undefined>(undefined)
  useEffect(() => { if (pending === saved) setPending(undefined) }, [pending, saved])
  const keepTabs = pending ?? saved
  return (
    <Row name={t('settings.keepTabs')} description={reloadNote(t, t('settings.keepTabs.hint'), keepTabs !== applied.keepTabs)}>
      <span data-testid="dsh-editor-settings-keep-tabs">
        <Switch
          checked={keepTabs}
          label={t('settings.keepTabs')}
          disabled={!ready}
          onChange={(next) => {
            setPending(next)
            void set('keepTabs', next)
          }}
        />
      </span>
    </Row>
  )
}

export function SettingsSection(props: SettingsSectionProps) {
  const { t } = props
  return (
    <div data-testid="dsh-editor-settings" style={page}>
      <div style={heading}>{t('settings.title')}</div>
      <div style={intro}>{t('settings.description')}</div>
      <EnabledRow {...props} />
      <ScopeRow {...props} />
      <KeepTabsRow {...props} />
    </div>
  )
}
