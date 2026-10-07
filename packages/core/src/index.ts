/**
 * Types shared with other packages. Runtime crosses packages only through the
 * `editor` Cordis service; import from here with `import type`.
 */
export type { EditorService, DocumentHandle } from './client/service.ts'
export type { EditorEngine, EngineBinding, EngineInstance } from './engines.ts'
export type { EditorScopeStrategy, ScopeEnv } from './scopes.ts'
export type { FileViewState } from './view-state.ts'
export type { DocumentStatus } from './document.ts'
export type { TextChange } from './diff.ts'
export type { CordisContext, SessionFileAddress } from './contract/dsh.ts'
export type { ContextSnapshot, EditorContext, SelectionInfo, SessionContextState } from './context.ts'
export type { EditorSettings } from './client/service.ts'
export type { FrameTarget, Translate } from './client/frame.ts'
export type { TabsState } from './view-state.ts'
