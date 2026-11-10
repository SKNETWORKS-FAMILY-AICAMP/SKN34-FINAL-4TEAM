import { afterEach, expect, it, vi } from 'vitest'

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

it('실제 모드 컨테이너는 서버 저장소를 쓴다(데모 대역을 쓰지 않는다)', () => {
  const container = createAppContainer()
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

it('실제 모드 컨테이너의 운영 댓글은 운영 API 저장소를 쓴다', () => {
  expect(createAppContainer().resolve('operationsCommentRepository').constructor.name).toBe('HttpOperationsCommentRepository')
})
