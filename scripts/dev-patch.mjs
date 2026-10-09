// Writes .dev/dev.patch.yml: the bundle's rows pointed at this checkout's
// built host entries, for `dsh --profile web --patch .dev/dev.patch.yml`.
// DSH resolves a local row by absolute file path (a directory fails to import).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patch = readFileSync(resolve(root, 'packages/bundle/cordis.patch.yml'), 'utf8')
const local = patch.replace(/name: '@dsh-editor\/([\w-]+)'/g, (_, pkg) =>
  `name: '${resolve(root, 'packages', pkg, 'lib/host.js').replaceAll('\\', '/')}'`)
mkdirSync(resolve(root, '.dev'), { recursive: true })
writeFileSync(resolve(root, '.dev/dev.patch.yml'), local)
console.log(local)
