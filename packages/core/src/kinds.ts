/**
 * Right-sidebar tab kinds the layouts register. The sidebar persists its tabs
 * across reloads, so after the `layout` setting changes, tabs of the other
 * layout's kinds come back; each layout registers those kinds too and turns
 * such a tab into its own equivalent (or closes it).
 */

/** Layout A: an editor tab. */
export const EDITOR_TAB_KIND = 'dsh-editor'
/** Layout B: the chat tab. */
export const CHAT_TAB_KIND = 'dsh-editor-chat'
/** Layout B: a file opened from the sidebar, handed to the centre. */
export const REDIRECT_TAB_KIND = 'dsh-editor-redirect'
