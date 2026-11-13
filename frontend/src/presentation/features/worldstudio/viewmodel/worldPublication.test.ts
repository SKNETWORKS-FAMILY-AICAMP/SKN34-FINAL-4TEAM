import { expect, it } from 'vitest'

import type { WorldPublication } from '../../../../domain/entities/studioWorld'
import { PUBLIC_CONFIRM, listingOf, needsPublicConfirm, publicationNotice } from './worldPublication'

const result = (over: Partial<WorldPublication> = {}): WorldPublication => ({ worldId: 'w', visibility: 'public', genre: null, publishedAt: '2026-11-12T00:00:00Z', listed: true, ...over })

it('asks only when a world that is not public yet is about to become public', () => {
  expect(needsPublicConfirm('private', 'public')).toBe(true)
  expect(needsPublicConfirm('public', 'public')).toBe(false) // 장르만 바꿀 때
  expect(needsPublicConfirm('public', 'private')).toBe(false)
  expect(needsPublicConfirm('private', 'private')).toBe(false)
  expect(PUBLIC_CONFIRM).toContain('공개하면 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있고, 로그인한 사람은 자기 세계관으로 가져갈 수 있어요')
})

it('tells the owner what the change did: private, public and listed, public but not listed yet', () => {
  expect(publicationNotice(result({ visibility: 'private', publishedAt: null, listed: false }), false)).toBe('비공개로 바꿨어요. 이제 나만 볼 수 있어요.')
  expect(publicationNotice(result(), false)).toBe('공개했어요. 누구나 공개로 둔 설정 카드와 그 사이의 인물 관계를 볼 수 있어요.')
  // 확정 버전이 없는 설명은 상태에서 계산하는 안내(UNLISTED_HINT)가 맡는다. 알림에 적어 두면 확정 버전을 남긴 뒤에도 낡은 채로 남는다.
  expect(publicationNotice(result({ listed: false }), false)).toBe('공개로 설정했어요.')
})

it('listingOf: 공개이고 확정 버전이 있을 때만 공개 목록에 나오고, 확정 버전이 없는 공개는 안내가 필요하다', () => {
  const world = (visibility?: 'private' | 'public', currentRevisionId?: string | null) => ({ visibility, currentRevisionId })
  expect(listingOf(world('public', 'rev-1'), false)).toBe('listed')
  expect(listingOf(world('public', null), false)).toBe('unlisted')
  expect(listingOf(world('public'), false)).toBe('unlisted') // 값이 없으면 확정 버전 없음
  expect(listingOf(world('private', 'rev-1'), false)).toBeNull()
  expect(listingOf(world(), false)).toBeNull() // 공개 범위 값이 없으면 비공개
  expect(listingOf(null, false)).toBeNull() // 아직 못 읽음
  expect(listingOf(world('public', 'rev-1'), true)).toBeNull() // 데모는 공개 목록이 없다
})

it('says a demo change only lives in memory and never promises a public listing', () => {
  for (const listed of [true, false]) {
    const text = publicationNotice(result({ listed }), true)
    expect(text).toContain('데모')
    expect(text).toContain('공개 목록에는 나타나지 않고')
    expect(text).not.toContain('확정 버전')
  }
  expect(publicationNotice(result({ visibility: 'private', publishedAt: null, listed: false }), true)).toBe('비공개로 바꿨어요. 이제 나만 볼 수 있어요.')
})
