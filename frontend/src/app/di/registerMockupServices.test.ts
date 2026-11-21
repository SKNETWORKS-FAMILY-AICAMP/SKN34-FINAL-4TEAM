import { afterEach, expect, it, vi } from 'vitest'

import { DEMO_WORLDS } from '../../data/mock/demoPublicWorlds'
import { createAppContainer } from './container'

const id = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
afterEach(() => vi.unstubAllEnvs())

it('mockup 컨테이너는 데모 집필실의 TXT 초안만 만들고 가져오기·EPUB·이름 변경·회차 이미지 관리는 미지원 오류로 답한다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  const manuscript = container.resolve('manuscriptUseCase')
  const [work] = await container.resolve('episodeUseCase').list()
  const txt = await manuscript.exportManuscript(work.id, { format: 'txt', source: 'draft', episode: 1 })
  expect(txt.filename).toBe('아버지라 부르지 못한 밤.txt')
  expect(await txt.blob.text()).toContain('조선국 세종 시절')
  await expect(manuscript.exportManuscript(work.id, { format: 'epub', source: 'draft' })).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(manuscript.preview(work.id, new File(['x'], '원고.txt'))).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(container.resolve('mediaUseCase').rename({ kind: 'setting', workId: work.id, settingId: id }, id, '새 이름.png')).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(container.resolve('mediaUseCase').listEpisodeImages(work.id, 1)).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(container.resolve('mediaUseCase').updateEpisodeImageAlt(work.id, 1, id, '설명')).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(container.resolve('mediaUseCase').publicEpisodeImageAlts(work.id, 1)).rejects.toThrow('데모에서는 지원하지 않아요')
})

it('mockup 컨테이너의 제보 저장소는 서버 대신 빈 목록·미지원 오류 대역이고 데모 작품 피드백은 기존 메모리 경로다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  const reports = container.resolve('feedbackReportUseCase')
  expect(await reports.listMine()).toEqual([])
  expect(await reports.listInbox()).toEqual([])
  await expect(reports.register('w', 1, { kind: 'typo', body: '본문', visibility: 'private' })).rejects.toThrow('데모에서는 지원하지 않아요')
  const feedback = container.resolve('feedbackUseCase')
  const [demo] = await container.resolve('workRepository').listWorks()
  expect(await feedback.sendFeedback({ workId: demo.id, n: 1, sentence: { t: '문장', pi: 0 }, type: '질문', text: '질문이에요', verified: false, nick: '독자' })).toMatchObject({ status: '응답 완료' })
})

it('실제 모드 컨테이너는 서버 저장소를 쓴다(데모 대역을 쓰지 않는다)', () => {
  const container = createAppContainer()
  expect(container.resolve('feedbackReportRepository').constructor.name).toBe('HttpFeedbackReportRepository')
  expect(container.resolve('manuscriptRepository').constructor.name).toBe('HttpManuscriptRepository')
  for (const method of ['rename', 'listEpisodeImages', 'updateEpisodeImageAlt', 'publicEpisodeImageAlts']) expect(Object.hasOwn(container.resolve('mediaRepository'), method)).toBe(false)
})

it('mockup 컨테이너의 운영 댓글은 서버 대신 데모 댓글을 운영 댓글 형태로 보여 주고 숨김을 메모리에 반영한다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const comments = createAppContainer().resolve('operationsCommentUseCase')
  const seed = (await comments.list()).find((c) => c.commentId === 'hanji-0')
  expect(seed).toMatchObject({ workTitle: '구운몽', authorName: '연화봉러', hidden: false })
  await comments.hide('hanji-0')
  expect((await comments.list()).find((c) => c.commentId === 'hanji-0')?.hidden).toBe(true)
})

it('운영 크레딧 저장소는 운영 API를 쓴다(회원 검색과 같이 서버 없는 시연용 대역은 두지 않는다)', () => {
  expect(createAppContainer().resolve('operationsCreditRepository').constructor.name).toBe('HttpOperationsCreditRepository')
})

it('실제 모드 컨테이너의 운영 댓글은 운영 API 저장소를 쓴다', () => {
  expect(createAppContainer().resolve('operationsCommentRepository').constructor.name).toBe('HttpOperationsCommentRepository')
})

it('활동 기록 저장소는 실제 모드에서 운영 API를, mockup에서 데모 조치 메모리를 쓴다', async () => {
  expect(createAppContainer().resolve('adminActivityRepository').constructor.name).toBe('HttpAdminActivityRepository')
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  expect(container.resolve('adminActivityRepository').constructor.name).toBe('InMemoryAdminActivityRepository')
  expect(await container.resolve('adminActivityUseCase').list()).toEqual([])
})

it('공개 세계관은 실제 모드에서 Content 공개 API 저장소를, mockup에서 데모 메모리를 쓴다', async () => {
  expect(createAppContainer().resolve('publicWorldRepository').constructor.name).toBe('HttpPublicWorldRepository')
  vi.stubEnv('MODE', 'mockup')
  const container = createAppContainer()
  expect(container.resolve('publicWorldRepository').constructor.name).toBe('InMemoryPublicWorldRepository')
  const useCase = container.resolve('publicWorldUseCase')
  const page = await useCase.list()
  expect([page.demo, page.items.length, page.total]).toEqual([true, DEMO_WORLDS.length, DEMO_WORLDS.length])
  expect((await useCase.get(DEMO_WORLDS[0].id))?.demo).toBe(true)
})

it('mockup 컨테이너의 탈퇴는 요청 없음 상태만 보이고 탈퇴·복구는 실제 계정을 바꾸지 않도록 미지원 오류로 답한다', async () => {
  vi.stubEnv('MODE', 'mockup')
  const withdrawal = createAppContainer().resolve('withdrawalUseCase')
  expect(await withdrawal.status()).toEqual({ status: 'NONE' })
  await expect(withdrawal.request('pw', '')).rejects.toThrow('데모에서는 지원하지 않아요')
  await expect(withdrawal.restore()).rejects.toThrow('데모에서는 지원하지 않아요')
})

it('운영 대시보드·LLMOps·작업 감시 저장소는 실제 모드에서 운영 API를, mockup에서 예시 메모리를 쓴다', async () => {
  const real = createAppContainer()
  expect(real.resolve('operationsDashboardRepository').constructor.name).toBe('HttpOperationsDashboardRepository')
  expect(real.resolve('llmOpsRepository').constructor.name).toBe('HttpLlmOpsRepository')
  expect(real.resolve('jobMonitorRepository').constructor.name).toBe('HttpJobMonitorRepository')
  vi.stubEnv('MODE', 'mockup')
  const mockup = createAppContainer()
  expect(mockup.resolve('operationsDashboardRepository').constructor.name).toBe('InMemoryOperationsDashboardRepository')
  expect(mockup.resolve('llmOpsRepository').constructor.name).toBe('InMemoryLlmOpsRepository')
  expect(mockup.resolve('jobMonitorRepository').constructor.name).toBe('InMemoryJobMonitorRepository')
  expect((await mockup.resolve('operationsDashboardUseCase').dashboard()).unavailable).toEqual([])
})

it('장르 저장소는 실제 모드에서 Content·운영 API를, mockup에서 같은 목록을 보는 메모리를 쓰고 홈 칩·세계관 이름이 그 목록을 따른다', async () => {
  const real = createAppContainer()
  expect(real.resolve('genreRepository').constructor.name).toBe('HttpGenreRepository')
  expect(real.resolve('operationsGenreRepository').constructor.name).toBe('HttpOperationsGenreRepository')
  vi.stubEnv('MODE', 'mockup')
  const mockup = createAppContainer()
  expect(mockup.resolve('genreRepository').constructor.name).toBe('InMemoryGenreRepository')
  expect(mockup.resolve('operationsGenreRepository').constructor.name).toBe('InMemoryOperationsGenreRepository')
  expect(await mockup.resolve('readingUseCase').homeChips()).toEqual(['추천', '✨ 판타지', '🛰 SF', '📜 고전', '🆓 무료', '✎ 포크 많은'])
  expect((await mockup.resolve('publicWorldUseCase').get(DEMO_WORLDS[0].id))?.genreName).toBe('판타지')
  // 운영에서 숨기면 작가 선택지(공개 목록)·홈 칩에서 빠지고, 세계관 장르는 이름을 알 수 없어 장르 없음처럼 된다.
  await mockup.resolve('operationsGenreUseCase').update('genre-01', { active: false })
  expect((await mockup.resolve('genreUseCase').list()).some((genre) => genre.code === 'genre-01')).toBe(false)
  expect((await mockup.resolve('readingUseCase').homeChips())).not.toContain('✨ 판타지')
  expect((await mockup.resolve('publicWorldUseCase').get(DEMO_WORLDS[0].id))?.genreName).toBeNull()
})
