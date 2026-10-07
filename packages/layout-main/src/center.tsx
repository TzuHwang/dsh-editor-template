/**
 * The centre editor: a tab bar over the editor frame. It occupies
 * `main.conversation`, so it receives the selected session (session-maybe).
 */
import type { TabsState, Translate } from '@dsh-editor/core'
import { useEffect, useRef } from 'react'

export interface CenterProps {
  readonly sessionId?: string
  readonly useSessions: <T>(selector: (state: { byId: Record<string, { cwd?: string } | undefined> }) => T) => T
  readonly useTabs: <T>(selector: (snapshot: Readonly<Record<string, TabsState>>) => T) => T
  readonly t: Translate
  readonly scopeKey: (sessionId: string | undefined, workspaceRoot: string | undefined) => string | null
  readonly ensureTabs: (scopeKey: string) => void
  readonly activateTab: (scopeKey: string, path: string) => void
  readonly closeTab: (scopeKey: string, path: string) => void
  /** Mount the editor frame (it carries its own `dshEditor` dictionary). */
  readonly attach: (host: HTMLElement, sessionId: string, path: string, workspaceRoot: string | undefined) => () => void
  readonly openFiles: () => void
  readonly openChat: () => void
  readonly showFull: () => void
}

const NO_TABS: TabsState = { open: [], active: null }

const bar = {
  display: 'flex', alignItems: 'center', gap: 2, padding: '6px 8px 0',
  borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
} as const
const tabStyle = (active: boolean) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 6px 6px 10px', fontSize: 13,
  borderRadius: '6px 6px 0 0', cursor: 'pointer', maxWidth: 200,
  background: active ? 'color-mix(in srgb, currentColor 7%, transparent)' : 'transparent',
  opacity: active ? 1 : 0.7,
}) as const
const plainButton = {
  border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit',
} as const
const actionButton = {
  ...plainButton, fontSize: 12, padding: '3px 10px', borderRadius: 6,
  border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
} as const

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function Center(props: CenterProps) {
  const { sessionId, t } = props
  const workspaceRoot = props.useSessions(state => sessionId === undefined ? undefined : state.byId[sessionId]?.cwd)
  const key = props.scopeKey(sessionId, workspaceRoot)
  const tabs = props.useTabs(snapshot => key === null ? NO_TABS : snapshot[key] ?? NO_TABS)
  const host = useRef<HTMLDivElement>(null)
  const { ensureTabs, attach } = props

  useEffect(() => {
    if (key !== null) ensureTabs(key)
  }, [key, ensureTabs])

  const active = tabs.active
  useEffect(() => {
    if (host.current === null || sessionId === undefined || active === null) return undefined
    return attach(host.current, sessionId, active, workspaceRoot)
  }, [sessionId, active, workspaceRoot, attach])

  if (sessionId === undefined || key === null) {
    return <div style={{ padding: 32, opacity: 0.7 }}>{t('center.noSession')}</div>
  }

  return (
    <div data-testid="dsh-editor-center" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={bar}>
        <div role="tablist" style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {tabs.open.map(path => (
            <div
              key={path}
              role="tab"
              aria-selected={path === active}
              title={path}
              style={tabStyle(path === active)}
              onClick={() => props.activateTab(key, path)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{basename(path)}</span>
              <button
                type="button"
                aria-label={t('center.closeTab')}
                style={{ ...plainButton, opacity: 0.5, padding: '0 2px' }}
                onClick={event => { event.stopPropagation(); props.closeTab(key, path) }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, paddingBottom: 6 }}>
          <button type="button" style={actionButton} onClick={props.showFull}>{t('center.fullConversation')}</button>
          <button type="button" data-testid="dsh-editor-open-chat" style={actionButton} onClick={props.openChat}>{t('center.openChat')}</button>
        </div>
      </div>
      {active === null
        ? (
            <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', opacity: 0.8 }}>
              <span>{t('center.empty')}</span>
              <button type="button" style={actionButton} onClick={props.openFiles}>{t('center.openFiles')}</button>
            </div>
          )
        : <div ref={host} key={active} style={{ flex: 1, minHeight: 0 }} />}
    </div>
  )
}
