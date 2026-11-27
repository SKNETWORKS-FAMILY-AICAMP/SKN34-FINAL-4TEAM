import { describe, expect, it } from 'vitest'

import { newSetting, type StudioSetting } from '../entities/studioWorld'
import { authorOnlyCard, bookState } from '../entities/studioWorldBook'

describe('bookState: 집필실 설정집 버튼과 알림의 상태(#986)', () => {
  it('세계관 id를 알면 다시 확인하는 중이거나 다시 확인에 실패해도 열린다', () => {
    expect(bookState({ worldId: 'w1', isLoading: false, isError: false })).toBe('ready')
    expect(bookState({ worldId: 'w1', isLoading: true, isError: false })).toBe('ready')
    expect(bookState({ worldId: 'w1', isLoading: false, isError: true })).toBe('ready')
  })

  it('id를 모르면 실패 → 확인 중 순으로 알리고 읽는 결과가 아직 없으면 확인 중이다', () => {
    expect(bookState({ worldId: undefined, isLoading: false, isError: true })).toBe('failed')
    expect(bookState({ worldId: undefined, isLoading: true, isError: false })).toBe('loading')
    expect(bookState({ worldId: undefined, isLoading: false, isError: false })).toBe('loading')
  })

  it('연결이 없다고 읽었으면 연결 없음이고, 다시 확인에 실패했으면 단정하지 않고 실패다', () => {
    expect(bookState({ worldId: null, isLoading: false, isError: false })).toBe('unlinked')
    expect(bookState({ worldId: null, isLoading: false, isError: true })).toBe('failed')
  })
})

describe('authorOnlyCard: 독자에게 아직 보이지 않는 카드', () => {
  const card = (patch: Partial<StudioSetting> = {}): StudioSetting => ({ ...newSetting('basic'), ...patch })

  it('공개 회차를 정하지 않은 카드는 작가 전용이다', () => {
    expect(authorOnlyCard(card())).toBe(true)
    expect(authorOnlyCard(card(), 5)).toBe(true)
  })

  it('공개 회차가 있으면 소설의 마지막 회차를 모르거나 그 안일 때 작가 전용이 아니다', () => {
    expect(authorOnlyCard(card({ revealFromEpisode: 3 }))).toBe(false)
    expect(authorOnlyCard(card({ revealFromEpisode: 3 }), 5)).toBe(false)
    expect(authorOnlyCard(card({ revealFromEpisode: 3 }), 3)).toBe(false)
  })

  it('소설에 아직 없는 회차로 정한 카드는 작가 전용이다(회차가 하나도 없는 소설 포함)', () => {
    expect(authorOnlyCard(card({ revealFromEpisode: 3 }), 2)).toBe(true)
    expect(authorOnlyCard(card({ revealFromEpisode: 1 }), 0)).toBe(true)
  })

  it('옛 공개 카드(공개 + 회차 없음)는 1화부터 공개로 읽는다', () => {
    expect(authorOnlyCard(card({ visibility: 'public' }), 4)).toBe(false)
  })
})
