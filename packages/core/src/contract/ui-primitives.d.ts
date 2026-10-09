/**
 * DSH's shared UI primitives, typed locally like the rest of contract/. The
 * package is part of the Web Client's baseline module table, so a plugin's
 * browser bundle imports it at run time (it is external in our build) and the
 * editor's settings rows look like DSH's own. Verified against 0.2.0-rc.2.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'

  export function Switch(props: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string
  }): ReactNode

  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items?: readonly { id: string; label: string }[]
    selectedId?: string
    onSelect?: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    portal?: boolean
  }): ReactNode

  export function IconChevronDownOutlineRegular(props: { className?: string; style?: object }): ReactNode
}
