import { describe, expect, it } from 'vitest'
import { ContextStore, MAX_SELECTION_CHARS, contextKey, effectiveContext, toEditorContext } from '../src/context.ts'

const at = (path: string, line: number, text = '') =>
  toEditorContext(path, { cursorLine: line, fromLine: line, toLine: line + (text.includes('\n') ? 1 : 0), text })

describe('toEditorContext', () => {
  it('omits an empty selection', () => {
    expect(at('a.md', 3)).toEqual({ path: 'a.md', cursorLine: 3 })
  })

  it('cuts a long selection and says so', () => {
    const context = at('a.md', 1, 'x'.repeat(MAX_SELECTION_CHARS + 5))
    expect(context.selection?.text).toHaveLength(MAX_SELECTION_CHARS)
    expect(context.selection?.truncated).toBe(true)
  })
})

describe('ContextStore', () => {
  it('lets the last active view speak for a session; closing another view changes nothing', () => {
    const store = new ContextStore()
    const first = {}
    const second = {}
    store.set('s', first, at('a.md', 1))
    store.set('s', second, at('b.md', 2))
    store.release('s', first)
    expect(effectiveContext(store.getSnapshot().s)?.path).toBe('b.md')
    store.release('s', second)
    expect(store.getSnapshot().s).toBeUndefined()
  })

  it('suppresses until the context changes', () => {
    const store = new ContextStore()
    const view = {}
    store.set('s', view, at('a.md', 1))
    store.suppress('s')
    expect(effectiveContext(store.getSnapshot().s)).toBeUndefined()
    store.set('s', view, at('a.md', 1))
    expect(effectiveContext(store.getSnapshot().s)).toBeUndefined()
    store.set('s', view, at('a.md', 2))
    expect(effectiveContext(store.getSnapshot().s)?.cursorLine).toBe(2)
  })

  it('keeps the snapshot identity when nothing changed', () => {
    const store = new ContextStore()
    const view = {}
    let notified = 0
    store.subscribe(() => { notified++ })
    store.set('s', view, at('a.md', 1))
    const snapshot = store.getSnapshot()
    store.set('s', view, at('a.md', 1))
    expect(store.getSnapshot()).toBe(snapshot)
    expect(notified).toBe(1)
  })

  it('keys contexts by what the model would see', () => {
    expect(contextKey(at('a.md', 1, 'x'))).toBe(contextKey(at('a.md', 1, 'x')))
    expect(contextKey(at('a.md', 1, 'x'))).not.toBe(contextKey(at('a.md', 1, 'y')))
  })
})
