/**
 * The right-sidebar chat beside the center editor: DSH's own conversation
 * (transcript, tool cards, composer with model selection, approvals and
 * questions) rendered as an embedded occurrence of the public
 * `conversation.content` Component Factory, the way DSH's subagent sidebar
 * chat does. The occurrence inherits this tab's Session; the View is fixed to
 * Chat and the main header and width handles are omitted.
 *
 * DSH supports one editable composer per Session. While the full conversation
 * is shown (DSH's own screen, with its composer, in the center) this tab shows
 * a note instead of a second composer.
 */
import type { Translate } from '@dsh-editor/core'
import type { ReactNode } from 'react'

// ---- DSH shapes, typed locally (see @dsh-editor/core contract/dsh.ts) ----

/** The fields of DSH's `SessionSnapshot` the shell phase is computed from. */
interface SessionPhaseFacts {
  readonly blank: boolean
  readonly awaitingFirstTurn: boolean
  readonly running: boolean
  readonly promptAttempted: boolean
  readonly openState: string
}

/** Props of the Factory's local `views` Component (`ConversationViewsProps`). */
interface ConversationViewsProps {
  readonly renderSlot: (name: 'conversation.session', props: { view: string }) => ReactNode
}

export type LayoutMode = 'editor' | 'full'

export interface ChatProps {
  readonly sessionId: string
  readonly t: Translate
  readonly useSession: <T>(selector: (snapshot: SessionPhaseFacts) => T) => T
  readonly useConversation: <T>(selector: (snapshot: { readonly activeTargets: ReadonlySet<unknown> }) => T) => T
  readonly useSessions: <T>(selector: (snapshot: { readonly byId: Readonly<Record<string, { readonly blank?: boolean } | undefined>> }) => T) => T
  readonly useLayoutMode: <T>(selector: (mode: LayoutMode) => T) => T
  readonly renderFactorySlot: (name: 'conversation.content', props: object, options: { slots: { views: (props: ConversationViewsProps) => ReactNode } }) => ReactNode
  readonly back: () => void
}

/** The embedded occurrence always shows the Chat View. */
function ChatView({ renderSlot }: ConversationViewsProps) {
  return <>{renderSlot('conversation.session', { view: 'chat' })}</>
}

export function Chat(props: ChatProps) {
  const { sessionId, t } = props
  // Shell phase as DSH's own embedded occurrence computes it (ui-subagent's sidebar chat).
  const session = props.useSession(snapshot => snapshot)
  const anyTarget = props.useConversation(snapshot => snapshot.activeTargets.size > 0)
  const summaryBlank = props.useSessions(snapshot => snapshot.byId[sessionId]?.blank)
  const mode = props.useLayoutMode(value => value)

  if (mode === 'full') {
    return (
      <div data-testid="dsh-chat-in-center" style={{ padding: 16, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ opacity: 0.7 }}>{t('chat.inCenter')}</span>
        <button
          type="button"
          onClick={props.back}
          style={{ font: 'inherit', fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', color: 'inherit', background: 'transparent', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)' }}
        >
          ← {t('header.backToEditor')}
        </button>
      </div>
    )
  }

  const shellPhase = anyTarget || (!session.blank && !session.awaitingFirstTurn) || session.running
    ? 'active'
    : session.promptAttempted ? 'engaging' : 'blank'
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  return (
    <div data-testid="dsh-chat" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero },
        { slots: { views: ChatView } },
      )}
    </div>
  )
}
