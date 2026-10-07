# dsh-editor-template

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin template: a text
editor with an AI chat beside it. Projects depend on these packages and extend them by registration.

Built against `@deepseek-ai/dsh` **0.2.0-rc.2**. DSH APIs used are declared in
[`packages/core/src/contract/dsh.ts`](packages/core/src/contract/dsh.ts); audit that file when upgrading DSH.

## Packages

| Package | Face | Role |
|---|---|---|
| `@dsh-editor/core` | host + client | `ctx.editor`: engine and scope registries, document sync with disk, view state; host save route |
| `@dsh-editor/text` | client | CodeMirror 6 engine for `.md`, `.py` and other text files, Markdown preview |
| `@dsh-editor/layout-tab` | client | Layout A: the editor opens as a right-sidebar tab for files an engine supports |
| `@dsh-editor/context` | host + client | Tells the AI which file is open and what is selected; removable chip above the composer |
| `@dsh-editor/layout-main` | client | Layout B: the editor fills the centre, a compact AI chat is a right-sidebar tab |
| `@dsh-editor/bundle` | bundle | The template's own DSH bundle (for trying the template; projects ship their own, see `starter/`) |

## Layouts and settings

The core entry (`id: dsh-editor-core`) has two settings. A card on the bundle's page under
**Plugins** edits them, and so does the profile patch; they apply on the next page load:

```yaml
- id: dsh-editor-core
  config:
    layout: main     # tab (default): editor in the right sidebar; main: editor in the centre
    scope: workspace # workspace (default) or session: who shares editor tabs and cursors
```

Layout B replaces DSH's `main.conversation` with the editor while a session with messages is
selected. A new session shows DSH's own start screen until its first message; "Full conversation"
shows DSH's conversation (tool details) with a "Back to editor" button in its header. Files opened
from the sidebar go to the centre. The chat tab handles approvals and AI questions; it does not
offer model selection (use the full conversation for that).

## Starting a project

Copy [`starter/`](starter/README.md). A project is its own DSH bundle: it lists the template's rows
in its `cordis.patch.yml`, extends the editor in its client plugin, and calls
`editor.registerSettingsCard('<its package name>')` so the settings card shows on its page.

## Extending

```ts
// A project's client plugin: inject: ['editor']
editor.engines.register({ id: 'odt', extensions: ['odt'], mount(host, binding) { /* ... */ } })
editor.scopes.register({ id: 'branch', resolveKey: env => /* ... */ null })
```

An engine mounts into a DOM element and talks to the document only through its `EngineBinding`
(`onLocalChange`, `save`, `applyExternal`). Saving, conflict handling and reloads are the core's job.

## Develop

```sh
pnpm install
pnpm test          # unit tests
pnpm typecheck
pnpm build         # packages/*/lib
pnpm smoke         # installs the bundle into a fresh DSH, drives both layouts in Edge
pnpm dev:patch     # writes .dev/dev.patch.yml pointing at this checkout
dsh --profile web --patch .dev/dev.patch.yml
```

`dsh` options (`--profile`, `--patch`) go before app options (`--port`, `--no-open`).

The smoke test installs the DSH version pinned in `package.json#dshVersion` into `.dev/`, runs
against a local mock of the model API (no key, no network beyond the install), and keeps its temp
directory with `failure.png` when a check fails. Upgrading DSH: bump `dshVersion`, audit
`contract/dsh.ts`, run `pnpm smoke`.

## Release and install

Push a tag `vX.Y.Z`. CI (`.github/workflows/release.yml`) typechecks, tests, builds, runs the smoke
test, then `scripts/release.mjs` commits the built `lib/` as tag `vX.Y.Z-dist` and prints the
install command. DSH profiles refuse git dependencies of installed packages (pnpm
`blockExoticSubdeps`), so every package is installed top level:

```sh
dsh plugin --profile web add \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/core" \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/text" \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/layout-tab" \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/layout-main" \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/context" \
  "github:TzuHwang/dsh-editor-template#vX.Y.Z-dist&path:/packages/bundle"
```

A project replaces the last line with its own package (`pnpm install-command` in the starter).

## Behaviour notes

- Disk is the source of truth. Edits autosave after 500 ms; `Ctrl+S` saves now. Every save is
  guarded by the version last read, so a concurrent agent write produces a conflict prompt
  instead of being overwritten.
- Files are read as bytes: the trailing newline, a UTF-8 BOM and CRLF line endings round-trip.
  A file mixing CRLF and LF is written back with its first line ending throughout.
- Leaving the editor (e.g. clicking the chat composer) saves at once, so the AI reads what is on screen.
- Editor context reaches the AI as a hidden `snapshot` user message (source `dsh-editor-context`),
  added on the step a user message enters and only when it changed since the last one in the
  session. The browser mirrors it to the host via `POST /dsh-editor/context`, because DSH 0.2 has
  no client hook on outgoing messages. A selection is cut to 2000 characters.
- DSH 0.2 offers no write API to plugins, so saving uses the authenticated route
  `POST /dsh-editor/write`, confined to the session's workspace. It is untested on the DSH
  desktop app, which reaches routes through an IPC bridge.
