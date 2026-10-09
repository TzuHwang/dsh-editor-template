/** Browser half of @dsh-editor/text: registers the CodeMirror engine. */
import type { CordisContext, EditorService } from '@dsh-editor/core'
import { textEngine } from './engine.ts'

export const name = 'dsh-editor-text'
export const inject = ['editor']

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService
  ctx.effect(() => editor.engines.register(textEngine), 'dsh-editor: text engine')
}
