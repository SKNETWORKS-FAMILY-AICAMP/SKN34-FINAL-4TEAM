import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createMockDb, InMemoryFeedbackRepository } from './InMemoryRepositories'

describe('unseeded runtime state', () => {
  it('keeps fixture modules outside the production state dependency', () => {
    expect(readFileSync(new URL('./InMemoryRepositories.ts', import.meta.url), 'utf8')).not.toMatch(/from ['"]\.\/seed['"]/)
  })
  it('does not inject sample works, world ownership, comments or reading records', async () => {
    const db = createMockDb()
    expect(db.works).toEqual([])
    expect(db.worlds).toEqual([])
    expect(db.progress).toEqual({ last: {}, read: {}, seen: {}, liked: {} })
    expect(await new InMemoryFeedbackRepository(db).listComments('hanji', 'work1')).toEqual([])
  })
})
