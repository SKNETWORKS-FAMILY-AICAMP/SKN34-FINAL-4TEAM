import { describe, expect, it } from 'vitest'

import { createMockupWorldStudioRepository, createMockupWritingRepository, mockupAuthRepository, mockupNotificationRepository } from './mockupRepositories'

describe('발표용 목업 저장소', () => {
  it('서버 없이 데모 회원으로 로그인 상태를 복원한다', async () => {
    await expect(mockupAuthRepository.refresh()).resolves.toMatchObject({ email: 'writer@storyfork.demo', operator: false })
    await expect(mockupAuthRepository.login('admin@storyfork.demo', 'x')).resolves.toMatchObject({ operator: true })
  })

  it('시연 ① 자동저장·버전 저장·복원·발행을 메모리에서 처리한다', async () => {
    const repo = createMockupWritingRepository()
    const [work] = await repo.list()
    const [ep] = await repo.writingList(work.id)
    expect(ep.draft.body).toContain('길동')
    const auto = await repo.writeEpisode(work.id, 1, { ...ep.draft, body: '초안' }, false)
    expect(auto.versions).toHaveLength(0)
    const v1 = (await repo.writeEpisode(work.id, 1, auto.draft, true)).versions[0]
    await repo.writeEpisode(work.id, 1, { ...auto.draft, body: '바뀐 초안' }, false)
    const restored = await repo.restoreEpisode(work.id, 1, 0, v1.id)
    expect(restored.versions.map((v) => v.body)).toEqual(['초안', '초안'])
    expect(restored.draft.body).toBe('초안')
    const published = await repo.publishEpisode(work.id, 1, 0, v1.id, true)
    expect(published.publishedVersionId).toBe(v1.id)
  })

  it('세계관 작업실에 홍길동전 예시를 미리 넣는다', async () => {
    const [world] = await createMockupWorldStudioRepository().listStudio()
    expect(world.name).toBe('홍길동전')
    expect(world.settings.some((s) => s.item.predicate === 'child_of')).toBe(true)
  })

  it('설정집·시간선·AI 후보 검토용 장소·사건 순서·근거 후보를 함께 넣는다', async () => {
    const [world] = await createMockupWorldStudioRepository().listStudio()
    const items = world.settings.map((s) => s.item)
    const ids = new Set(items.map((i) => i.id))
    expect(items.filter((i) => i.entityType === 'location').length).toBeGreaterThan(1)
    const events = items.filter((i) => i.kind === 'event')
    expect(events.some((e) => e.afterId && ids.has(e.afterId))).toBe(true)
    expect(items.flatMap((i) => i.relatedIds).every((id) => ids.has(id))).toBe(true)
    expect(world.analysis?.candidates.length).toBeGreaterThan(0)
    expect(world.analysis?.candidates.every((c) => c.decision === 'pending' && c.evidence.length > 0)).toBe(true)
  })

  it('알림은 빈 목록으로 응답한다', async () => {
    await expect(mockupNotificationRepository.list()).resolves.toEqual({ items: [], nextCursor: null })
    await expect(mockupNotificationRepository.unreadCount()).resolves.toBe(0)
  })
})
