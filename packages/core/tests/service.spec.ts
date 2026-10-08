import { describe, expect, it } from 'vitest'
import { EditorService } from '../src/client/service.ts'
import type { WorkspaceFilesRemote } from '../src/contract/dsh.ts'

const noFiles: WorkspaceFilesRemote = {
  readBytes: async () => ({ ok: false, error: { code: 'workspace-file/not-found' } }),
  changes: async function* () {},
}

describe('EditorService.flushAll', () => {
  it('awaits every mounted self-managed engine, until it is removed', async () => {
    const service = new EditorService(noFiles, undefined)
    const saved: string[] = []
    const removeA = service.addFlusher(async () => { saved.push('a') })
    service.addFlusher(async () => { saved.push('b') })
    await service.flushAll()
    expect(saved.sort()).toEqual(['a', 'b'])
    removeA()
    await service.flushAll()
    expect(saved.sort()).toEqual(['a', 'b', 'b'])
  })

  it('does not let a failing engine block the others (or the chat message waiting on it)', async () => {
    const service = new EditorService(noFiles, undefined)
    let saved = false
    service.addFlusher(async () => { throw new Error('disk full') })
    service.addFlusher(async () => { saved = true })
    await expect(service.flushAll()).resolves.toBeUndefined()
    expect(saved).toBe(true)
  })
})
