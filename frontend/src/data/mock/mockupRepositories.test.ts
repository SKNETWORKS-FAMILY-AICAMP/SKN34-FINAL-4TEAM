import { describe, expect, it } from 'vitest'

import { createMockupManuscriptRepository, createMockupWorldStudioRepository, createMockupWritingRepository, mockupAuthRepository, mockupFeedbackReportRepository, mockupNotificationRepository, mockupUnsupportedMedia } from './mockupRepositories'

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

  it('원고 가져오기와 첨부 이름 변경은 성공을 흉내 내지 않고 데모 미지원 오류를 낸다', async () => {
    const file = new File(['x'], '원고.txt')
    const repo = createMockupManuscriptRepository(createMockupWritingRepository())
    await expect(repo.preview('w', file)).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(repo.confirm('w', file, true, [])).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(mockupUnsupportedMedia.rename({ kind: 'cover', workId: 'w' }, 'id', '새.png')).rejects.toThrow('데모에서는 지원하지 않아요')
  })

  it('회차 이미지 목록·대체 텍스트 저장·공개 설명 조회도 성공을 흉내 내지 않고 데모 미지원 오류를 낸다', async () => {
    await expect(mockupUnsupportedMedia.listEpisodeImages('w', 1)).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(mockupUnsupportedMedia.updateEpisodeImageAlt('w', 1, 'id', '설명')).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(mockupUnsupportedMedia.publicEpisodeImageAlts('w', 1)).rejects.toThrow('데모에서는 지원하지 않아요')
  })

  it('데모 집필실의 TXT 초안 내보내기는 메모리 원고로 실제 파일을 만든다', async () => {
    const writing = createMockupWritingRepository()
    const repo = createMockupManuscriptRepository(writing)
    const [work] = await writing.list()
    const [first] = await writing.writingList(work.id)
    const current = await repo.exportManuscript(work.id, { format: 'txt', source: 'draft', episode: 1 })
    expect(current.filename).toBe('아버지라 부르지 못한 밤.txt')
    // Blob.text()는 UTF-8 BOM을 떼고 돌려주므로 BOM은 바이트로 확인한다.
    expect([...new Uint8Array(await current.blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await current.blob.text()).toBe(`${first.draft.title}\n\n${first.draft.body}`)
    // 저장한 초안이 바로 반영되고 이미지 표식은 TXT에서 빠진다.
    const marker = '[[image:6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10]]'
    await writing.writeEpisode(work.id, 1, { title: '고친/제목', body: `앞\n\n${marker}\n\n뒤`, revision: first.draft.revision }, false)
    await writing.createEpisode(work.id, '둘째 회차')
    expect(await (await repo.exportManuscript(work.id, { format: 'txt', source: 'draft', episode: 1 })).blob.text()).toBe('고친/제목\n\n앞\n\n\n\n뒤')
    expect((await repo.exportManuscript(work.id, { format: 'txt', source: 'draft', episode: 1 })).filename).toBe('고친_제목.txt')
    const whole = await repo.exportManuscript(work.id, { format: 'txt', source: 'draft' })
    expect(whole.filename).toBe('홍길동전 다시 쓰기.txt')
    expect(await whole.blob.text()).toBe('홍길동전 다시 쓰기\n\n\n고친/제목\n\n앞\n\n\n\n뒤\n\n\n둘째 회차\n\n')
  })

  it('정본 작품이 없는 목업의 제보 저장소는 빈 목록으로 답하고 쓰기는 성공을 흉내 내지 않고 미지원 오류로 답한다', async () => {
    const repo = mockupFeedbackReportRepository
    await expect(repo.listEpisode('w', 1)).resolves.toEqual([])
    await expect(repo.listMine()).resolves.toEqual([])
    await expect(repo.listInbox()).resolves.toEqual([])
    const writes = [
      repo.create('w', 1, { kind: 'typo', body: '본문', visibility: 'private' }), repo.setVisibility('w', 'r', 'public'), repo.correct('w', 'r', '정정'),
      repo.withdraw('w', 'r'), repo.check('w', 'r'), repo.answer('w', 'r', { body: '답변', isPublic: false }), repo.setStatus('w', 'r', 'closed'),
    ]
    for (const write of writes) await expect(write).rejects.toThrow('데모에서는 지원하지 않아요')
  })

  it('데모 TXT 내보내기도 EPUB·발행본은 미지원 오류로, 없는 회차는 서버와 같은 안내로 답한다', async () => {
    const writing = createMockupWritingRepository()
    const repo = createMockupManuscriptRepository(writing)
    const [work] = await writing.list()
    await expect(repo.exportManuscript(work.id, { format: 'epub', source: 'draft' })).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(repo.exportManuscript(work.id, { format: 'txt', source: 'published' })).rejects.toThrow('데모에서는 지원하지 않아요')
    await expect(repo.exportManuscript(work.id, { format: 'txt', source: 'draft', episode: 9 })).rejects.toThrow('내보낼 수 있는 회차가 없어요.')
  })
})
