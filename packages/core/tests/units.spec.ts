import { describe, expect, it } from 'vitest'
import { parseSessionFileAddress } from '../src/contract/dsh.ts'
import { diffText } from '../src/diff.ts'
import { EngineRegistry, extensionOf, isSelfManaged, type EditorEngine, type SelfManagedEngine } from '../src/engines.ts'
import { ScopeRegistry, sessionScope, workspaceScope } from '../src/scopes.ts'
import { NotTextError, decodeText } from '../src/text-codec.ts'
import { STORAGE_PREFIX, ViewStateStore, type KeyValueStorage } from '../src/view-state.ts'

const engine = (id: string, extensions: string[]): EditorEngine => ({
  id,
  extensions,
  mount: () => { throw new Error('not mounted in tests') },
})

const selfManaged = (id: string, extensions: string[]): SelfManagedEngine => ({
  id,
  extensions,
  selfManaged: true,
  mount: () => { throw new Error('not mounted in tests') },
})

describe('diffText', () => {
  it('replaces only the changed middle', () => {
    expect(diffText('hello world', 'hello brave world')).toEqual([{ from: 6, to: 6, insert: 'brave ' }])
    expect(diffText('abc', 'abc')).toEqual([])
    expect(diffText('aXc', 'aYc')).toEqual([{ from: 1, to: 2, insert: 'Y' }])
  })

  it('handles repeated characters without overlapping prefix and suffix', () => {
    expect(diffText('aaa', 'aaaa')).toEqual([{ from: 3, to: 3, insert: 'a' }])
  })
})

describe('decodeText', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('keeps the trailing newline and a BOM', () => {
    expect(decodeText(bytes('a\n')).text).toBe('a\n')
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('a')])
    expect(decodeText(withBom).text).toBe('\uFEFFa')
  })

  it('detects CRLF files', () => {
    expect(decodeText(bytes('a\r\nb\r\n')).lineSeparator).toBe('\r\n')
    expect(decodeText(bytes('a\nb')).lineSeparator).toBe('\n')
  })

  it('rejects binary content', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(NotTextError)
    expect(() => decodeText(bytes('a\0b'))).toThrow(NotTextError)
  })
})

describe('EngineRegistry', () => {
  it('resolves by extension, case-insensitively, latest registration first', () => {
    const registry = new EngineRegistry()
    registry.register(engine('text', ['md', 'py']))
    const dispose = registry.register(engine('fancy-md', ['md']))
    expect(registry.resolve('docs/README.MD')?.id).toBe('fancy-md')
    expect(registry.resolve('a.py')?.id).toBe('text')
    expect(registry.resolve('image.png')).toBeUndefined()
    expect(registry.resolve('.gitignore')).toBeUndefined()
    dispose()
    expect(registry.resolve('README.md')?.id).toBe('text')
  })

  it('rejects a duplicate engine id', () => {
    const registry = new EngineRegistry()
    registry.register(engine('text', ['md']))
    expect(() => registry.register(engine('text', ['py']))).toThrow(/already registered/)
  })

  it('holds self-managed engines in the same extension order, and tells them apart', () => {
    const registry = new EngineRegistry()
    registry.register(engine('text', ['txt', 'odt']))
    const dispose = registry.register(selfManaged('office', ['odt', 'docx']))
    const office = registry.resolve('report.ODT')
    expect(office?.id).toBe('office')
    expect(office !== undefined && isSelfManaged(office)).toBe(true)
    expect(isSelfManaged(registry.resolve('a.txt')!)).toBe(false)
    dispose()
    expect(registry.resolve('report.odt')?.id).toBe('text')
    expect(registry.resolve('a.docx')).toBeUndefined()
  })

  it('extensionOf ignores directories with dots', () => {
    expect(extensionOf('a.b/c')).toBe('')
    expect(extensionOf('a.b/c.TS')).toBe('ts')
  })
})

describe('ScopeRegistry', () => {
  it('resolves keys per strategy and falls back to session for unknown ids', () => {
    const registry = new ScopeRegistry()
    registry.register(workspaceScope)
    registry.register(sessionScope)
    const env = { workspaceRoot: 'C:/ws', sessionId: 's1' }
    expect(registry.get('workspace').resolveKey(env)).toBe('workspace:C:/ws')
    expect(registry.get('session').resolveKey(env)).toBe('session:s1')
    expect(registry.get('nope').id).toBe('session')
    expect(registry.get('workspace').resolveKey({ workspaceRoot: undefined, sessionId: 's1' })).toBeNull()
  })

  it('accepts a project strategy', () => {
    const registry = new ScopeRegistry()
    registry.register({ id: 'branch', resolveKey: () => 'branch:main' })
    expect(registry.get('branch').resolveKey({ workspaceRoot: undefined, sessionId: undefined })).toBe('branch:main')
  })
})

describe('ViewStateStore', () => {
  const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value) },
      removeItem: key => { data.delete(key) },
    }
  }

  it('round-trips view state through storage', () => {
    const storage = memory()
    new ViewStateStore(storage).set('workspace:w', 'a.md', { anchor: 1, head: 2, scrollTop: 30 })
    expect(new ViewStateStore(storage).get('workspace:w', 'a.md')).toEqual({ anchor: 1, head: 2, scrollTop: 30 })
  })

  it('clears only a corrupt key', () => {
    const storage = memory()
    storage.setItem(STORAGE_PREFIX + 'bad', '{"files":{"a.md":{"anchor":-1}}}')
    storage.setItem(STORAGE_PREFIX + 'good', '{"files":{}}')
    expect(new ViewStateStore(storage).get('bad', 'a.md')).toBeUndefined()
    expect(storage.data.has(STORAGE_PREFIX + 'bad')).toBe(false)
    expect(storage.data.has(STORAGE_PREFIX + 'good')).toBe(true)
  })

  it('keeps working when storage throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    const store = new ViewStateStore(broken)
    store.set('s', 'a.md', { anchor: 0, head: 0, scrollTop: 0 })
    expect(store.get('s', 'a.md')).toEqual({ anchor: 0, head: 0, scrollTop: 0 })
  })
})

describe('parseSessionFileAddress', () => {
  it('decodes session addresses and refuses others', () => {
    expect(parseSessionFileAddress('dsh-resource://file/session/s%201/docs/a%23b.md'))
      .toEqual({ sessionId: 's 1', path: 'docs/a#b.md' })
    expect(parseSessionFileAddress('dsh-resource://file/absolute/C:/x.md')).toBeUndefined()
    expect(parseSessionFileAddress('dsh-resource://file/session/s/%E0%A4%A.md')).toBeUndefined()
  })
})

describe('ViewStateStore tabs', () => {
  const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value) },
      removeItem: key => { data.delete(key) },
    }
  }

  it('opens, activates and closes tabs, persisting them with the scope', () => {
    const storage = memory()
    const store = new ViewStateStore(storage)
    store.openTab('w', 'a.md')
    store.openTab('w', 'b.md')
    store.openTab('w', 'a.md')
    expect(store.getTabsSnapshot().w).toEqual({ open: ['a.md', 'b.md'], active: 'a.md' })
    store.closeTab('w', 'a.md')
    expect(store.getTabsSnapshot().w).toEqual({ open: ['b.md'], active: 'b.md' })
    store.closeTab('w', 'b.md')
    expect(store.getTabsSnapshot().w).toEqual({ open: [], active: null })
    store.openTab('w', 'c.md')
    const reloaded = new ViewStateStore(storage)
    reloaded.ensureTabs('w')
    expect(reloaded.getTabsSnapshot().w).toEqual({ open: ['c.md'], active: 'c.md' })
  })

  it('keeps cursor state and tabs side by side, and reads states saved before tabs existed', () => {
    const storage = memory()
    storage.setItem(STORAGE_PREFIX + 'old', '{"files":{"a.md":{"anchor":1,"head":1,"scrollTop":0}}}')
    const store = new ViewStateStore(storage)
    store.ensureTabs('old')
    expect(store.getTabsSnapshot().old).toEqual({ open: [], active: null })
    store.openTab('old', 'a.md')
    expect(new ViewStateStore(storage).get('old', 'a.md')).toEqual({ anchor: 1, head: 1, scrollTop: 0 })
  })

  it('rejects an active tab that is not open', () => {
    const storage = memory()
    storage.setItem(STORAGE_PREFIX + 'bad', '{"files":{},"tabs":{"open":["a.md"],"active":"b.md"}}')
    const store = new ViewStateStore(storage)
    store.ensureTabs('bad')
    expect(store.getTabsSnapshot().bad).toEqual({ open: [], active: null })
    expect(storage.data.has(STORAGE_PREFIX + 'bad')).toBe(false)
  })
})

describe('sessionFileAddress', () => {
  it('round-trips through parseSessionFileAddress', async () => {
    const { sessionFileAddress } = await import('../src/contract/dsh.ts')
    for (const path of ['docs/a#b c.md', 'C:/x/y.md', '中文/筆記.md']) {
      expect(parseSessionFileAddress(sessionFileAddress('s 1', path))).toEqual({ sessionId: 's 1', path })
    }
  })
})
