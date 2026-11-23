import { describe, expect, it } from 'vitest'

import { reportTargetTitle, reportTargetTypeLabel } from '../entities/report'

const base = { targetType: 'work' as const, workTitle: '달빛 도서관', episodeNumber: null, worldName: null }

describe('신고 대상 표시(결정 D)', () => {
  it('작품은 제목, 회차는 제목과 회차 번호, 세계관은 이름으로 보인다', () => {
    expect(reportTargetTitle(base)).toBe('달빛 도서관')
    expect(reportTargetTitle({ ...base, targetType: 'episode', episodeNumber: 3 })).toBe('달빛 도서관 3화')
    expect(reportTargetTitle({ ...base, targetType: 'world', workTitle: null, worldName: '별빛 세계' })).toBe('별빛 세계')
  })

  it('이름을 모르는(지워진) 대상은 종류만 쓰고 회차 번호가 없으면 작품으로 읽는다', () => {
    expect(reportTargetTitle({ ...base, workTitle: null })).toBe('작품')
    expect(reportTargetTitle({ ...base, targetType: 'world', workTitle: null })).toBe('세계관')
    expect(reportTargetTitle({ ...base, targetType: 'episode' })).toBe('달빛 도서관')
  })

  it('대상 종류는 작품·회차·세계관 이름으로 보이고 모르는 값은 그대로 보인다', () => {
    expect(['work', 'episode', 'world'].map((type) => reportTargetTypeLabel(type as 'work'))).toEqual(['작품', '회차', '세계관'])
    expect(reportTargetTypeLabel('chat' as never)).toBe('chat')
  })
})
