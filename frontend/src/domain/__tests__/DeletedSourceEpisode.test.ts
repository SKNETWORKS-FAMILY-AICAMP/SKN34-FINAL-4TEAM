import { describe, expect, it } from 'vitest'
import { hiddenSourceEpisode, type Work } from '../entities/work'

const fork = (extra: Partial<Work> = {}) => ({ parent: 'src', forkAt: 2, parentDeleted: true, ...extra }) as Work

describe('hiddenSourceEpisode', () => {
  it('marks only empty inherited episodes of a Fork whose original was deleted', () => {
    expect(hiddenSourceEpisode(fork(), 1, [''])).toBe(true)
    // 소유자는 원작 본문을 그대로 받는다.
    expect(hiddenSourceEpisode(fork(), 1, ['원작 본문'])).toBe(false)
    expect(hiddenSourceEpisode(fork(), 3, [''])).toBe(false)
    expect(hiddenSourceEpisode(fork({ parentDeleted: false }), 1, [''])).toBe(false)
    expect(hiddenSourceEpisode(fork({ parent: undefined }), 1, [''])).toBe(false)
  })
})
