/**
 * Right-sidebar tab kinds the editor registers. The sidebar persists its tabs
 * across reloads, so after the editor is turned off these tabs come back with
 * nothing to draw them; the layout then registers the kinds only to close them.
 */

/** The AI chat beside the center editor. */
export const CHAT_TAB_KIND = 'dsh-editor-chat'
/** A file opened from the sidebar, handed to the center editor. */
export const REDIRECT_TAB_KIND = 'dsh-editor-redirect'
/** Editor tabs of the sidebar layout early builds had; they only close themselves now. */
export const LEGACY_EDITOR_TAB_KIND = 'dsh-editor'
