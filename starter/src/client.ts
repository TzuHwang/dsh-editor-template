/**
 * This project's browser plugin. The editor, both layouts, AI context and
 * settings come from dsh-editor-template; extend them here through `ctx.editor`.
 */
import type { CordisContext, EditorService } from '@dsh-editor/core'

export const name = 'my-dsh-project'
export const inject = ['editor']

/** Must equal package.json#name: DSH keys the plugin page by bundle package name. */
const BUNDLE = 'my-dsh-project'

export function apply(ctx: CordisContext): void {
  const editor = ctx.editor as EditorService

  // The editor settings (layout, scope) on this bundle's plugin page.
  ctx.effect(() => editor.registerSettingsCard(BUNDLE), 'my-dsh-project: settings card')

  // Project extensions. Each registration returns its disposer; wrap it in ctx.effect.
  //
  // A format of your own (it mounts into a DOM element; see EditorEngine in @dsh-editor/core):
  //   ctx.effect(() => editor.engines.register({ id: 'odt', extensions: ['odt'], mount(host, binding) { ... } }))
  //
  // Who shares editor tabs and cursors (select it with the `scope` setting):
  //   ctx.effect(() => editor.scopes.register({ id: 'per-branch', resolveKey: env => ... }))
}
