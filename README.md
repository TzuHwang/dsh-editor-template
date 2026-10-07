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
| `@dsh-editor/bundle` | bundle | The DSH bundle that installs the packages above |

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
pnpm dev:patch     # writes .dev/dev.patch.yml pointing at this checkout
dsh --profile web --patch .dev/dev.patch.yml
```

`dsh` options (`--profile`, `--patch`) go before app options (`--port`, `--no-open`).

## Behaviour notes

- Disk is the source of truth. Edits autosave after 500 ms; `Ctrl+S` saves now. Every save is
  guarded by the version last read, so a concurrent agent write produces a conflict prompt
  instead of being overwritten.
- Files are read as bytes: the trailing newline, a UTF-8 BOM and CRLF line endings round-trip.
  A file mixing CRLF and LF is written back with its first line ending throughout.
- DSH 0.2 offers no write API to plugins, so saving uses the authenticated route
  `POST /dsh-editor/write`, confined to the session's workspace. It is untested on the DSH
  desktop app, which reaches routes through an IPC bridge.
