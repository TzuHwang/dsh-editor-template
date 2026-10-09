/**
 * The center editor: a tab bar over the editor frames. It occupies
 * `main.conversation`, so it receives the selected session (session-maybe).
 *
 * Each frame mounts into its own element inside one host that stays in the
 * page while the center does, so a closing frame that keeps its element
 * (hidden) until it finishes, e.g. a self-managed engine saving, is not cut
 * off. Only the active tab's frame is mounted, or, with `keepTabs`, every tab
 * activated since it opened stays mounted and only the active one shows.
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
  /** Keep inactive tabs' frames mounted (the `keepTabs` setting). */
  readonly keepTabs: boolean
}

const NO_TABS: TabsState = { open: [], active: null }

/** One mounted frame: its element in the host and its detach function. */
interface Mounted {
  readonly element: HTMLDivElement
  readonly detach: () => void
}

/** Detach a frame; its element leaves the host once the frame removed everything it kept. */
function release(mounted: Mounted): void {
  const { element } = mounted
  element.style.display = 'none'
  mounted.detach()
  if (element.firstChild === null) {
    element.remove()
    return
  }
  const observer = new MutationObserver(() => {
    if (element.firstChild !== null) return
    observer.disconnect()
    element.remove()
  })
  observer.observe(element, { childList: true })
}

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
  const { ensureTabs, attach, keepTabs } = props
  /** Mounted frames by path, all for `framesFor`. */
  const frames = useRef(new Map<string, Mounted>())
  const framesFor = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (key !== null) ensureTabs(key)
  }, [key, ensureTabs])

  const active = tabs.active
  const open = tabs.open
  useEffect(() => {
    const mounted = frames.current
    if (framesFor.current !== sessionId) {
      for (const frame of mounted.values()) release(frame)
      mounted.clear()
      framesFor.current = sessionId
    }
    for (const [path, frame] of mounted) {
      const wanted = path === active || (keepTabs && open.includes(path))
      if (!wanted) {
        release(frame)
        mounted.delete(path)
      }
    }
    if (host.current !== null && sessionId !== undefined && active !== null && !mounted.has(active)) {
      const element = document.createElement('div')
      element.style.height = '100%'
      host.current.append(element)
      mounted.set(active, { element, detach: attach(element, sessionId, active, workspaceRoot) })
    }
    for (const [path, frame] of mounted) frame.element.style.display = path === active ? '' : 'none'
  }, [sessionId, active, open, keepTabs, workspaceRoot, attach])

  // Leaving the center detaches everything.
  useEffect(() => () => {
    for (const frame of frames.current.values()) release(frame)
    frames.current.clear()
  }, [])

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
      {active === null && (
        <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', opacity: 0.8 }}>
          <span>{t('center.empty')}</span>
          <button type="button" style={actionButton} onClick={props.openFiles}>{t('center.openFiles')}</button>
        </div>
      )}
      {/* Always rendered, never re-keyed: closing frames may still hold elements in it. */}
      <div ref={host} style={{ flex: 1, minHeight: 0, display: active === null ? 'none' : undefined }} />
    </div>
  )
}
