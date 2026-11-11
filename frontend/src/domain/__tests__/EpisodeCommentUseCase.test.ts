import { describe, expect, it, vi } from 'vitest'

import type { EpisodeComment } from '../entities/episodeComment'
import type { EpisodeCommentRepository } from '../repositories/EpisodeCommentRepository'
import { EpisodeCommentUseCase } from '../usecases/EpisodeCommentUseCase'

const comment = (extra: Partial<EpisodeComment> = {}): EpisodeComment => ({
  id: 'c1', workId: 'w1', episodeNumber: 3, publishedVersionId: 'v1', authorName: '닉네임', body: '본문', quote: null, spoiler: false,
  likeCount: 0, liked: false, mine: true, edited: false, hidden: false, createdAt: '2026-11-09T01:23:45Z', updatedAt: '2026-11-09T01:23:45Z', ...extra,
})
const setup = () => {
  const repo = {
    list: vi.fn(async () => [comment()]), listByWork: vi.fn(async () => [comment()]), create: vi.fn(async () => comment()), update: vi.fn(async () => comment()),
    remove: vi.fn(async () => {}), like: vi.fn(async () => {}), unlike: vi.fn(async () => {}),
  } satisfies EpisodeCommentRepository
  return { repo, useCase: new EpisodeCommentUseCase(repo) }
}
const untouched = (repo: ReturnType<typeof setup>['repo']) => Object.values(repo).forEach((fn) => expect(fn).not.toHaveBeenCalled())

describe('회차 댓글 UseCase', () => {
  it('목록은 작품·회차·정렬을 저장소에 그대로 넘긴다', async () => {
    const { repo, useCase } = setup()
    expect(await useCase.list('w1', 3, 'likes')).toEqual([comment()])
    expect(repo.list).toHaveBeenCalledWith('w1', 3, 'likes')
  })

  it('작품 전체 목록은 작품·정렬을 저장소에 그대로 넘긴다', async () => {
    const { repo, useCase } = setup()
    expect(await useCase.listByWork('w1', 'likes')).toEqual([comment()])
    expect(repo.listByWork).toHaveBeenCalledWith('w1', 'likes')
    expect(repo.list).not.toHaveBeenCalled()
  })

  it('작성은 앞뒤 공백을 지운 본문과 스포일러 여부를 보내고 인용이 없으면 quote를 생략한다', async () => {
    const { repo, useCase } = setup()
    await useCase.create('w1', 3, { body: '  좋았어요\n', quote: null, spoiler: true })
    await useCase.create('w1', 3, { body: '그냥', quote: '', spoiler: false })
    expect(repo.create).toHaveBeenNthCalledWith(1, 'w1', 3, { body: '좋았어요', spoiler: true })
    expect(repo.create).toHaveBeenNthCalledWith(2, 'w1', 3, { body: '그냥', spoiler: false })
  })

  it('선택 문장은 quote로 보낸다', async () => {
    const { repo, useCase } = setup()
    await useCase.create('w1', 3, { body: '이 문장이요', quote: '성진은 복숭아꽃 한 가지를 꺾어 던졌다.', spoiler: false })
    expect(repo.create).toHaveBeenCalledWith('w1', 3, { body: '이 문장이요', quote: '성진은 복숭아꽃 한 가지를 꺾어 던졌다.', spoiler: false })
  })

  it.each([['빈 문자열', ''], ['공백', '  \n '], ['NBSP 공백', '  ']])('작성은 %s 본문을 저장소 호출 없이 거절한다', async (_name, body) => {
    const { repo, useCase } = setup()
    await expect(useCase.create('w1', 3, { body, spoiler: false })).rejects.toThrow('댓글 내용을 입력해 주세요')
    untouched(repo)
  })

  it('본문은 공백을 뺀 500자까지 허용하고 501자는 저장소 호출 없이 거절한다', async () => {
    const { repo, useCase } = setup()
    await useCase.create('w1', 3, { body: ` ${'가'.repeat(500)} `, spoiler: false })
    expect(repo.create).toHaveBeenCalledWith('w1', 3, { body: '가'.repeat(500), spoiler: false })
    repo.create.mockClear()
    await expect(useCase.create('w1', 3, { body: '가'.repeat(501), spoiler: false })).rejects.toThrow('500자')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('인용 문장이 500자를 넘으면 잘라 보내지 않고 거절한다', async () => {
    const { repo, useCase } = setup()
    await useCase.create('w1', 3, { body: '본문', quote: '나'.repeat(500), spoiler: false })
    repo.create.mockClear()
    await expect(useCase.create('w1', 3, { body: '본문', quote: '나'.repeat(501), spoiler: false })).rejects.toThrow('인용')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('수정은 같은 검증을 거쳐 댓글의 작품·회차·ID로 본문과 스포일러만 보낸다', async () => {
    const { repo, useCase } = setup()
    const own = comment({ quote: '인용은 바뀌지 않는다' })
    await useCase.update(own, ' 고친 글 ', true)
    expect(repo.update).toHaveBeenCalledWith('w1', 3, 'c1', { body: '고친 글', spoiler: true })
    repo.update.mockClear()
    await expect(useCase.update(own, '   ', false)).rejects.toThrow('댓글 내용을 입력해 주세요')
    await expect(useCase.update(own, '가'.repeat(501), false)).rejects.toThrow('500자')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('삭제는 댓글의 작품·회차·ID로 요청한다', async () => {
    const { repo, useCase } = setup()
    await useCase.remove(comment({ id: 'c9', workId: 'w2', episodeNumber: 5 }))
    expect(repo.remove).toHaveBeenCalledWith('w2', 5, 'c9')
  })

  it('좋아요는 현재 상태에 따라 등록·취소를 고른다', async () => {
    const { repo, useCase } = setup()
    await useCase.toggleLike(comment({ liked: false }))
    expect(repo.like).toHaveBeenCalledWith('w1', 3, 'c1')
    expect(repo.unlike).not.toHaveBeenCalled()
    await useCase.toggleLike(comment({ liked: true }))
    expect(repo.unlike).toHaveBeenCalledWith('w1', 3, 'c1')
    expect(repo.like).toHaveBeenCalledTimes(1)
  })

  it('저장소 실패는 숨기지 않고 그대로 던진다', async () => {
    const { repo, useCase } = setup()
    repo.create.mockRejectedValueOnce(new Error('공개 회차를 찾을 수 없어요.'))
    await expect(useCase.create('w1', 3, { body: '본문', spoiler: false })).rejects.toThrow('공개 회차를 찾을 수 없어요.')
    repo.like.mockRejectedValueOnce(new Error('서버 인증이 필요합니다.'))
    await expect(useCase.toggleLike(comment())).rejects.toThrow('서버 인증이 필요합니다.')
  })
})
