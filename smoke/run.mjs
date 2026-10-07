// Smoke test (design Q14): installs the bundle into a fresh DSH profile with
// `dsh plugin add`, boots `dsh web` against a local mock LLM, and drives both
// layouts in a real browser. Guards DSH upgrades: unit tests mock DSH, this
// does not.
//
//   pnpm smoke                 build, then run
//   pnpm smoke --no-build      run against the current lib/ output
//   SMOKE_BROWSER=chromium     Playwright channel (default msedge)
//   SMOKE_KEEP=1               keep the temp directory even on success
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { AI_EDIT_TEXT, startMockLlm, userTurns } from './mock-llm.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = path => path.replaceAll('\\', '/')
const { dshVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = new Set(process.argv.slice(2))

// ---- helpers ----

function run(command, commandArgs, options = {}) {
  // npm and pnpm are .cmd shims on Windows, which need a shell; arguments here are fixed strings.
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited with ${result.status}`)
}

function killTree(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

const failures = []
function check(name, condition, detail) {
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${name}${condition || detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`)
  if (!condition) failures.push(name)
}

async function eventually(probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value || Date.now() > deadline) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

// ---- DSH runtime, pinned by package.json#dshVersion ----

const runtime = join(root, '.dev', `dsh-${dshVersion}`)
const dshBin = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(dshBin)) {
  console.log(`installing @deepseek-ai/dsh@${dshVersion} into ${runtime}`)
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'package.json'), '{"private":true}\n')
  run('npm', ['install', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${dshVersion}`], { cwd: runtime })
}
if (!args.has('--no-build')) run('pnpm', ['build'], { cwd: root })

// ---- a fresh DSH home, workspace and profile ----

const temp = mkdtempSync(join(tmpdir(), 'dsh-editor-smoke-'))
const home = join(temp, 'home')
const documents = join(temp, 'documents')
const workspace = join(documents, 'deepseek-harness', 'default-workspace')
mkdirSync(workspace, { recursive: true })
writeFileSync(join(workspace, 'notes.md'), '# Notes\r\n\r\nfirst line\r\nsecond line\r\n')
writeFileSync(join(workspace, 'script.py'), 'print("hi")\n')
const overlay = join(temp, 'smoke.patch.yml')
writeFileSync(overlay, `- id: workspace-controller\n  config:\n    documentsDirectory: '${posix(documents)}'\n`)

const env = { ...process.env, DSH_HOME: home }
const dsh = (dshArgs, options = {}) => run(process.execPath, [dshBin, ...dshArgs], { cwd: temp, env, shell: false, ...options })
dsh(['--profile', 'smoke', '--from-default-profile', 'web', '--dump-config'], { stdio: 'ignore' })
dsh(['plugin', '--profile', 'smoke', 'add', posix(join(root, 'packages', 'bundle'))])

const llm = await startMockLlm(posix(workspace))
let server
let browser
let page
const disk = name => readFileSync(join(workspace, name), 'utf8')

async function boot() {
  const child = spawn(process.execPath, [dshBin, '--profile', 'smoke', '--patch', overlay, '--no-open', '--port', '0'], {
    cwd: temp,
    env: { ...env, DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'smoke-not-a-real-key' },
  })
  let log = ''
  const url = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      log += chunk
      const match = /dsh web: (http:\/\/\S+)/.exec(log)
      if (match) resolve(match[1])
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => reject(new Error(`dsh exited (${code}) before serving:\n${log}`)))
    setTimeout(() => reject(new Error(`dsh did not start in time:\n${log}`)), 120_000)
  })
  check('dsh boots with the bundle installed, no inactive entries', !/did not activate/.test(log), log)
  return { child, url }
}

async function openPage(url) {
  await page.goto(url)
  await page.waitForLoadState('networkidle').catch(() => {})
  await eventually(async () => (await page.getByText(/^(新会话|New session)$/).count()) > 0, 30_000)
  for (const name of [/^(继续|Continue)$/, /^(稍后配置|Later|Configure later)$/]) {
    const button = page.getByRole('button', { name })
    if (await button.count()) await button.first().click()
  }
}

/** Open a workspace file from DSH's file tree (Ctrl+Alt+P opens and expands it). */
async function openFromFiles(name) {
  const entry = page.locator('[data-rightbar-col]').getByText(name, { exact: true })
  if (!(await eventually(async () => (await entry.count()) > 0, 1_000))) {
    await page.locator('body').click({ position: { x: 640, y: 200 } })
    await page.keyboard.press('Control+Alt+P')
    await eventually(async () => (await entry.count()) > 0)
  }
  await entry.last().click()
}

const composer = () => page.locator('[contenteditable=true]').filter({ hasNot: page.locator('.cm-line') }).last()

try {
  browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER ?? 'msedge', headless: true })
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1500, height: 900 } })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  // ---- layout A (default) ----
  console.log('layout A')
  server = await boot()
  await openPage(server.url)
  await openFromFiles('notes.md')
  const status = page.getByTestId('dsh-editor-status')
  check('a .md file opens in the editor tab', await eventually(async () => (await status.count()) > 0))
  await page.locator('.cm-line').nth(2).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')
  check('autosave keeps CRLF and the final newline', await eventually(() => disk('notes.md') === '# Notes\r\n\r\nfirst line edited\r\nsecond line\r\n'), disk('notes.md'))
  writeFileSync(join(workspace, 'notes.md'), `${disk('notes.md')}from disk\r\n`)
  check('a change on disk reaches the editor', await eventually(async () => (await page.locator('.cm-line').allInnerTexts()).includes('from disk')))
  check('the context chip shows the open file', await eventually(async () => (await page.getByTestId('dsh-editor-context-chip').count()) > 0))
  await composer().click()
  await page.keyboard.type('hello from layout A')
  await page.keyboard.press('Enter')
  check('the AI receives the editor context', await eventually(() =>
    userTurns(llm.requests).some(parts => parts.includes('hello from layout A') && parts.some(part => part.includes('`notes.md` open')))))

  // ---- switch to layout B through the settings card ----
  console.log('settings → layout B')
  await page.getByText(/^(插件|Plugins)$/).first().click()
  await page.getByText('@dsh-editor/bundle').first().click()
  const layout = page.getByTestId('dsh-editor-settings-layout')
  check('the settings card is on the bundle page', await eventually(async () => (await layout.count()) > 0))
  await layout.selectOption('main')
  check('the setting is saved to the profile', await eventually(() => /layout: main/.test(readFileSync(join(home, 'profiles', 'smoke', 'cordis.patch.yml'), 'utf8'))))

  // ---- layout B ----
  console.log('layout B')
  await openPage(server.url)
  await page.getByText('hello from layout A').first().click().catch(() => {})
  const center = page.getByTestId('dsh-editor-center')
  check('the centre editor replaces the conversation', await eventually(async () => (await center.count()) > 0))
  await openFromFiles('script.py')
  check('a file opened from the sidebar lands in the centre', await eventually(async () =>
    (await center.locator('[role=tab]').allInnerTexts()).some(text => text.includes('script.py'))))
  await page.getByTestId('dsh-editor-open-chat').click()
  const input = page.getByTestId('dsh-chat-input')
  check('the chat tab opens', await eventually(async () => (await input.count()) > 0))

  await input.fill('TRIGGER_ASK')
  await input.press('Enter')
  const question = page.getByTestId('dsh-chat-question')
  check('an AI question shows in the chat', await eventually(async () => (await question.count()) > 0))
  await question.getByRole('button', { name: 'Blue' }).click()
  await question.getByRole('button', { name: /^(提交|Submit)$/ }).click()
  check('the answer reaches the AI', await eventually(() =>
    userTurns(llm.requests).some(parts => parts.some(part => part.includes('[tool_result]') && part.includes('Blue')))))

  await input.fill('TRIGGER_WRITE')
  await input.press('Enter')
  const approval = page.getByTestId('dsh-chat-approval')
  check('an approval request shows in the chat', await eventually(async () => (await approval.count()) > 0))
  await approval.getByRole('button', { name: /^(允许一次|Allow once)$/ }).click()
  check('the approved command runs', await eventually(async () => (await approval.count()) === 0 && (await page.getByTestId('dsh-chat-tool').allInnerTexts()).some(text => text.includes('✓ pwsh'))))

  await openFromFiles('notes.md')
  await input.fill('TRIGGER_EDIT')
  await input.press('Enter')
  check('an AI edit reaches the centre editor', await eventually(async () =>
    (await center.locator('.cm-line').allInnerTexts()).includes('written by the AI')), 15_000)
  check('the AI edit is on disk', disk('notes.md') === AI_EDIT_TEXT, disk('notes.md'))

  check('no uncaught page errors', errors.length === 0, errors)
} catch (error) {
  failures.push(String(error?.stack ?? error))
  console.error(error)
} finally {
  if (page !== undefined && failures.length > 0) await page.screenshot({ path: join(temp, 'failure.png') }).catch(() => {})
  await browser?.close().catch(() => {})
  if (server !== undefined) killTree(server.child)
  await llm.close()
}

if (failures.length > 0) {
  console.error(`\nsmoke FAILED (${failures.length}). Kept ${temp} (failure.png, DSH home).`)
  process.exit(1)
}
if (process.env.SMOKE_KEEP) console.log(`kept ${temp}`)
else rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
console.log('\nsmoke passed')
