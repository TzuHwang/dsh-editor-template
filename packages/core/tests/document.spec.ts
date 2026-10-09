import { describe, expect, it } from 'vitest'
import { DocumentSync, type DiskText, type DocumentIO, type DocumentStatus, type Scheduler, type WriteResult } from '../src/document.ts'

/** An in-memory file with version guarding, standing in for the host. */
class FakeDisk implements DocumentIO {
  text: string | undefined
  version = 0
  writes: { text: string; expected: string | undefined }[] = []
  /** When set, the next write waits until released. */
  gate: Promise<void> | undefined

  constructor(text: string | undefined) {
    this.text = text
  }

  /** Someone else (the AI) writes the file. */
  externalWrite(text: string | undefined): string {
    this.text = text
    this.version++
    return String(this.version)
  }

  async read(): Promise<DiskText | undefined> {
    return this.text === undefined ? undefined : { text: this.text, version: String(this.version) }
  }

  async write(text: string, expected: string | undefined): Promise<WriteResult> {
    this.writes.push({ text, expected })
    if (this.gate !== undefined) await this.gate
    if (expected !== undefined && expected !== String(this.version)) return { kind: 'stale' }
    this.text = text
    this.version++
    return { kind: 'ok', version: String(this.version) }
  }
}

/** Manual timers: `fire()` runs the pending debounce. */
class ManualScheduler implements Scheduler {
  pending: (() => void) | undefined
  set(callback: () => void): unknown {
    this.pending = callback
    return callback
  }
  clear(handle: unknown): void {
    if (this.pending === handle) this.pending = undefined
  }
  fire(): void {
    const callback = this.pending
    this.pending = undefined
    callback?.()
  }
}

async function open(initial: string | undefined) {
  const disk = new FakeDisk(initial)
  const scheduler = new ManualScheduler()
  const doc = new DocumentSync(disk, { scheduler })
  const statuses: DocumentStatus['kind'][] = []
  const externals: string[] = []
  doc.subscribe({ status: s => statuses.push(s.kind), external: text => externals.push(text) })
  await doc.load()
  return { disk, scheduler, doc, statuses, externals }
}

describe('DocumentSync', () => {
  it('loads the file text exactly, trailing newline included', async () => {
    const { doc } = await open('# a\n')
    expect(doc.getText()).toBe('# a\n')
    expect(doc.status.kind).toBe('clean')
  })

  it('autosaves after the debounce, guarded by the version it read', async () => {
    const { disk, scheduler, doc } = await open('a')
    doc.edit('ab')
    expect(doc.status.kind).toBe('dirty')
    expect(disk.writes).toHaveLength(0)
    scheduler.fire()
    await doc.flush()
    expect(disk.writes).toEqual([{ text: 'ab', expected: '0' }])
    expect(disk.text).toBe('ab')
    expect(doc.status.kind).toBe('clean')
  })

  it('flush saves immediately and cancels the pending debounce', async () => {
    const { disk, scheduler, doc } = await open('a')
    doc.edit('ab')
    await doc.flush()
    expect(disk.text).toBe('ab')
    expect(scheduler.pending).toBeUndefined()
  })

  it('applies an external change to a clean document as a diff', async () => {
    const { disk, doc, externals } = await open('hello\n')
    const version = disk.externalWrite('hello\nworld\n')
    await doc.externalChange(version)
    expect(doc.getText()).toBe('hello\nworld\n')
    expect(externals).toEqual(['hello\nworld\n'])
    expect(doc.status.kind).toBe('clean')
  })

  it('ignores the watcher echo of its own write', async () => {
    const { disk, doc, externals } = await open('a')
    doc.edit('ab')
    await doc.flush()
    await doc.externalChange(String(disk.version))
    // A different version with the same content (metadata-only change) is also a no-op.
    await doc.externalChange('touched')
    expect(externals).toEqual([])
    expect(doc.status.kind).toBe('clean')
  })

  it('enters conflict when disk changes while the user has unsaved edits, and never autosaves over it', async () => {
    const { disk, scheduler, doc } = await open('base')
    doc.edit('base mine')
    const version = disk.externalWrite('base theirs')
    await doc.externalChange(version)
    expect(doc.status).toEqual({ kind: 'conflict', diskText: 'base theirs' })
    doc.edit('base mine more')
    scheduler.fire()
    await doc.flush()
    expect(disk.writes).toHaveLength(0)
    expect(disk.text).toBe('base theirs')
  })

  it('resolves a conflict by taking the disk version', async () => {
    const { disk, doc, externals } = await open('base')
    doc.edit('mine')
    await doc.externalChange(disk.externalWrite('theirs'))
    await doc.resolveConflict('disk')
    expect(doc.getText()).toBe('theirs')
    expect(externals).toEqual(['theirs'])
    expect(doc.status.kind).toBe('clean')
    expect(disk.writes).toHaveLength(0)
  })

  it('resolves a conflict by keeping mine, overwriting the version it saw', async () => {
    const { disk, doc } = await open('base')
    doc.edit('mine')
    const version = disk.externalWrite('theirs')
    await doc.externalChange(version)
    await doc.resolveConflict('mine')
    expect(disk.text).toBe('mine')
    expect(disk.writes.at(-1)).toEqual({ text: 'mine', expected: version })
    expect(doc.status.kind).toBe('clean')
  })

  it('turns a stale save into a conflict instead of overwriting', async () => {
    const { disk, doc } = await open('base')
    doc.edit('mine')
    disk.externalWrite('theirs') // watcher has not reported it yet
    await doc.flush()
    expect(disk.text).toBe('theirs')
    expect(doc.status).toEqual({ kind: 'conflict', diskText: 'theirs' })
  })

  it('treats disk converging on the editor text as clean', async () => {
    const { disk, doc } = await open('base')
    doc.edit('same')
    await doc.externalChange(disk.externalWrite('same'))
    expect(doc.status.kind).toBe('clean')
  })

  it('keeps edits made while a save is in flight', async () => {
    const { disk, scheduler, doc } = await open('a')
    let release!: () => void
    disk.gate = new Promise(resolve => { release = resolve })
    doc.edit('ab')
    scheduler.fire()
    await Promise.resolve()
    doc.edit('abc')
    release()
    disk.gate = undefined
    await doc.flush()
    scheduler.fire()
    await doc.flush()
    expect(disk.text).toBe('abc')
    expect(doc.status.kind).toBe('clean')
  })

  it('reports a deleted file as missing and recreates it on the next edit', async () => {
    const { disk, doc } = await open('a')
    await doc.externalChange(undefined)
    disk.externalWrite(undefined)
    await doc.externalChange(undefined)
    expect(doc.status.kind).toBe('missing')
    await doc.flush()
    expect(disk.writes).toHaveLength(0)
    doc.edit('b')
    await doc.flush()
    expect(disk.text).toBe('b')
    expect(disk.writes.at(-1)?.expected).toBeUndefined()
  })

  it('surfaces a write error and recovers on the next save', async () => {
    const { doc } = await open('a')
    const failing = new DocumentSync({
      read: async () => ({ text: 'a', version: '1' }),
      write: async () => ({ kind: 'error', message: 'disk full' }),
    })
    await failing.load()
    failing.edit('b')
    await failing.flush()
    expect(failing.status).toEqual({ kind: 'error', message: 'disk full' })
    expect(doc.status.kind).toBe('clean')
  })
})
