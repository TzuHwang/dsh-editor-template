// Publish a release as a git tag that projects install from (design Q13: git
// URL dependencies, no registry). Run on a built checkout of tag vX.Y.Z:
//
//   node scripts/release.mjs v0.1.0 [--repo owner/name] [--dry-run] [--no-push]
//                                   [--git-url <url>]   (other hosts, or a local repo for testing)
//
// It sets every package's version, drops runtime `workspace:*` dependencies (DSH
// profiles refuse git subdependencies, so every package is installed top level;
// the printed command does that), points devDependencies at the
// same release (`github:<repo>#<tag>-dist&path:/packages/<dir>`), commits the
// built lib/ (ignored on ordinary branches) on a detached HEAD, and pushes the
// `<tag>-dist` tag. Projects depend on that tag; see starter/.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = { 'dry-run': false, 'no-push': false, repo: process.env.GITHUB_REPOSITORY, 'git-url': undefined }
const positional = []
for (const argv = process.argv.slice(2); argv.length > 0;) {
  const arg = argv.shift()
  if (arg === '--dry-run' || arg === '--no-push') options[arg.slice(2)] = true
  else if (arg === '--repo' || arg === '--git-url') options[arg.slice(2)] = argv.shift()
  else positional.push(arg)
}
const [tag] = positional
const dryRun = options['dry-run']
const push = !options['no-push']
const gitUrl = options['git-url']
const repo = options.repo

if (tag === undefined || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
  console.error('usage: node scripts/release.mjs vX.Y.Z [--repo owner/name | --git-url <url>] [--dry-run] [--no-push]')
  process.exit(2)
}
if (gitUrl === undefined && (repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo))) {
  console.error('repository unknown: pass --repo owner/name, --git-url <url>, or set GITHUB_REPOSITORY')
  process.exit(2)
}

const version = tag.slice(1)
const distTag = `${tag}-dist`
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim()

// Package name -> directory under packages/.
const packages = new Map(readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
  .map(entry => [JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8')).name, entry.name]))

const releaseUrl = dir => `${gitUrl ?? `github:${repo}`}#${distTag}&path:/packages/${dir}`

for (const [name, dir] of packages) {
  const file = join(root, 'packages', dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.version = version
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
      if (!String(range).startsWith('workspace:')) continue
      const target = packages.get(dependency)
      if (target === undefined) throw new Error(`${name}: ${dependency} is not a workspace package`)
      // DSH profiles install with pnpm's blockExoticSubdeps: a git dependency of an
      // installed package is refused. Every package is installed top level instead
      // (see installCommand), so released runtime dependencies on siblings are dropped;
      // devDependencies keep the link for type checking.
      if (field === 'devDependencies') manifest[field][dependency] = releaseUrl(target)
      else delete manifest[field][dependency]
    }
    if (manifest[field] !== undefined && Object.keys(manifest[field]).length === 0) delete manifest[field]
  }
  const lib = join(root, 'packages', dir, 'lib')
  if (manifest.main !== undefined && !existsSync(lib)) throw new Error(`${name}: lib/ missing; build before releasing`)
  if (dryRun) console.log(`${name}@${version}\n${JSON.stringify({ dependencies: manifest.dependencies ?? {} }, null, 2)}`)
  else writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Installs the template's packages, bundle last, into a DSH profile. */
const installCommand = [
  'dsh plugin --profile <profile> add',
  ...[...packages.values()].sort((a, b) => Number(a === 'bundle') - Number(b === 'bundle')).map(dir => `  "${releaseUrl(dir)}"`),
].join(' \\\n')

if (dryRun) {
  console.log(`\ndry run: would commit lib/ and push tag ${distTag}\n\n${installCommand}`)
  process.exit(0)
}

git('checkout', '--detach')
git('add', '--force', ...[...packages.values()].flatMap(dir => {
  const lib = `packages/${dir}/lib`
  return existsSync(join(root, lib)) ? [lib] : []
}), ...[...packages.values()].map(dir => `packages/${dir}/package.json`))
git('commit', '--message', `release: ${tag} (built)`)
git('tag', distTag)
if (push) git('push', 'origin', distTag)
console.log(`${push ? 'pushed' : 'tagged'} ${distTag}. Install with:\n\n${installCommand}`)
