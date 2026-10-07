# my-dsh-project

A DeepSeek Harness (DSH) project built on
[dsh-editor-template](https://github.com/TzuHwang/dsh-editor-template): a text editor with an AI chat
beside it. Copy this folder to start a project, then rename `my-dsh-project` in `package.json`,
`cordis.patch.yml` and `src/`.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm build                       # lib/host.js, lib/client.js
```

Try it in DSH with the template packages from the pinned release plus this checkout:

```sh
pnpm install-command --project "$(pwd)"   # prints the dsh plugin add command
```

## What comes from the template

`cordis.patch.yml` loads the template's packages (editor core, CodeMirror text engine, both
layouts, AI context) and this project's plugin. The template release is pinned in
`package.json#dshEditor.release` and in the `@dsh-editor/core` dev dependency; change both to upgrade.

Extend through `ctx.editor` in `src/client.ts`: register editor engines for new formats and scope
strategies. Users turn the editor on under Settings → General → Editor mode.

## Release

Build, commit `lib/` on a tag (DSH loads built files; there is no install-time build), and install:

```sh
pnpm install-command --project "github:<owner>/<repo>#<tag>"
```

DSH profiles refuse git dependencies of installed packages, so the template's packages are
installed top level next to this project, never as its dependencies.
