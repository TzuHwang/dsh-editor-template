// Smoke-test fixture: a self-managed engine for `.bin` files. The core only
// mounts it; it reads the bytes itself (workspaceFiles), shows them in hex,
// appends 0x2a on a button press, and saves when focus leaves it, when asked (`flush`)
// or when its view closes (`destroy`). Written in the client bundle format DSH
// loads (see scripts/build-package.mjs), so it needs no build.
//
// It also claims `.bin` files for a sidebar tab type of its own, the way other
// plugins (e.g. dsh-better-sidebar) claim every file: same pattern, same band,
// registered before the editor's. The editor must still get them.
window.__ModuleLoader__.load({ id: 'dsh-editor-smoke-self-managed', factory: () => {
  const WRITE_ROUTE = '/dsh-editor-smoke/write'
  const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ')

  const engineFor = files => ({
    id: 'smoke-self-managed',
    extensions: ['bin'],
    selfManaged: true,
    mount(host, binding) {
      const document = host.ownerDocument
      let bytes = new Uint8Array(0)
      let dirty = false
      const view = document.createElement('div')
      const shown = document.createElement('pre')
      shown.dataset.testid = 'smoke-bin-bytes'
      const append = document.createElement('button')
      append.type = 'button'
      append.textContent = 'append 2a'
      append.dataset.testid = 'smoke-bin-append'
      const render = () => { shown.textContent = hex(bytes) }
      append.addEventListener('click', () => {
        bytes = new Uint8Array([...bytes, 0x2a])
        dirty = true
        render()
      })
      view.append(shown, append)
      host.append(view)
      // For the smoke test: how often views mount (kept tabs do not remount) ...
      window.__smokeMounts = (window.__smokeMounts ?? 0) + 1
      // ... and what the AI is told: this file, line 1.
      binding.onSelection({ cursorLine: 1, fromLine: 1, toLine: 1, text: '' }, false)

      void files.readBytes(binding.sessionId, binding.path, {}).then(result => {
        if (!result.ok) throw new Error(result.error.code)
        bytes = result.value.data
        render()
      })

      const flush = async () => {
        if (!dirty) return
        dirty = false
        const query = new URLSearchParams({ root: binding.workspaceRoot ?? '', path: binding.path })
        const response = await fetch(`${WRITE_ROUTE.slice(1)}?${query}`, { method: 'POST', body: bytes })
        if (!response.ok) {
          dirty = true
          throw new Error(`save failed: HTTP ${response.status}`)
        }
      }
      // Leaving the engine (e.g. for the chat composer) saves, so the AI reads what is on screen.
      view.addEventListener('focusout', () => { void flush().catch(() => {}) })

      return {
        flush,
        focus() { append.focus() },
        // Save before letting go: the core keeps the element in the page until this settles.
        // The smoke test checks that promise: still in the page a moment later.
        destroy: () => new Promise(resolve => setTimeout(resolve, 300))
          .then(() => { window.__smokeKeptWhileClosing = view.isConnected })
          .then(flush)
          .finally(() => view.remove()),
      }
    },
  })

  return {
    name: 'dsh-editor-smoke-self-managed',
    inject: ['editor', 'remote', 'remote.workspaceFiles', 'sidebarRightTabs'],
    apply(ctx) {
      ctx.effect(() => ctx.editor.engines.register(engineFor(ctx.remote.workspaceFiles)), 'dsh-editor smoke: self-managed engine')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-editor-smoke-file-claimer',
        kind: 'dsh-editor-smoke-file-claimer',
        multiple: true,
        patterns: ['dsh-resource://file/**'],
        priority: 'extension',
        canOpen: address => address.endsWith('.bin'),
        title: address => address.slice(address.lastIndexOf('/') + 1),
      }), 'dsh-editor smoke: a competing file tab type')
    },
  }
} })
