import { describe, expect, it, vi } from 'vitest'

import type { Attachment, EpisodeImage } from '../entities/media'
import type { MediaRepository } from '../repositories/MediaRepository'
import { MediaUseCase } from '../usecases/MediaUseCase'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const settingId = '1eecb1f7-f76d-4688-9793-b73e93899f52'
const id = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const setting = { kind: 'setting' as const, workId, settingId }
const renamed: Attachment = { id, filename: '새 지도.png', mediaType: 'image/png', kind: 'IMAGE', byteSize: 3, createdAt: '2026-11-03T10:00:00Z', url: '/unused' }

const image: EpisodeImage = { id, filename: '다리.png', mediaType: 'image/png', byteSize: 3, altText: '다리', createdAt: '2026-11-03T10:00:00Z', url: '/unused', referenced: true }

function setup() {
  const repo = {
    list: vi.fn(), upload: vi.fn(), remove: vi.fn(), download: vi.fn(), rename: vi.fn(async () => renamed),
    listEpisodeImages: vi.fn(async () => [image]), updateEpisodeImageAlt: vi.fn(async () => image), publicEpisodeImageAlts: vi.fn(async () => ({ [id]: '다리' })),
  } satisfies MediaRepository
  return { repo, api: new MediaUseCase(repo) }
}

describe('첨부 이름 변경 입력 검사', () => {
  it('설정 첨부의 올바른 이름만 취소 신호와 함께 저장소에 넘긴다', async () => {
    const { repo, api } = setup()
    const signal = new AbortController().signal
    expect(await api.rename(setting, id, '새 지도.png', signal)).toBe(renamed)
    expect(repo.rename).toHaveBeenCalledWith(setting, id, '새 지도.png', signal)
  })

  it('설정 첨부가 아니거나 식별자·이름 규칙을 어기면 보내지 않는다', async () => {
    const { repo, api } = setup()
    await expect(api.rename({ kind: 'cover', workId }, id, '표지.png')).rejects.toThrow('설정 첨부')
    await expect(api.rename({ kind: 'episode', workId, number: 1 }, id, '삽화.png')).rejects.toThrow('설정 첨부')
    await expect(api.rename({ ...setting, workId: 'demo' }, id, '지도.png')).rejects.toThrow('작품')
    await expect(api.rename(setting, 'not-a-uuid', '지도.png')).rejects.toThrow('식별자')
    for (const bad of ['', '.hidden.png', 'a..b.png', ' 앞공백.png', '뒷공백.png ', 'a/b.png', `${'a'.repeat(118)}.png`]) {
      await expect(api.rename(setting, id, bad), bad).rejects.toThrow('파일 이름')
    }
    expect(repo.rename).not.toHaveBeenCalled()
  })

  it('이름 규칙 검사를 업로드와 같이 쓴다', async () => {
    const { repo, api } = setup()
    await expect(api.upload(setting, new File(['x'], 'a..b.png'))).rejects.toThrow('파일 이름')
    expect(repo.upload).not.toHaveBeenCalled()
  })
})

describe('회차 이미지 목록·대체 텍스트 입력 검사', () => {
  it('실제 작품·회차 번호만 서버에 묻고 응답을 그대로 돌려준다', async () => {
    const { repo, api } = setup()
    const signal = new AbortController().signal
    expect(await api.listEpisodeImages(workId, 2, signal)).toEqual([image])
    expect(repo.listEpisodeImages).toHaveBeenCalledWith(workId, 2, signal)
    expect(await api.publicEpisodeImageAlts(workId, 2, signal)).toEqual({ [id]: '다리' })
    expect(repo.publicEpisodeImageAlts).toHaveBeenCalledWith(workId, 2, signal)
    for (const call of [() => api.listEpisodeImages('demo', 1), () => api.listEpisodeImages(workId, 0), () => api.publicEpisodeImageAlts('demo', 1), () => api.publicEpisodeImageAlts(workId, 1.5)]) {
      await expect(call()).rejects.toThrow(/작품|회차/)
    }
    expect(repo.listEpisodeImages).toHaveBeenCalledTimes(1)
    expect(repo.publicEpisodeImageAlts).toHaveBeenCalledTimes(1)
  })

  it('대체 텍스트는 앞뒤 공백을 뗀 0~300자 한 줄만 보낸다', async () => {
    const { repo, api } = setup()
    const signal = new AbortController().signal
    expect(await api.updateEpisodeImageAlt(workId, 2, id, '  강 위의 다리  ', signal)).toBe(image)
    expect(repo.updateEpisodeImageAlt).toHaveBeenLastCalledWith(workId, 2, id, '강 위의 다리', signal)
    await api.updateEpisodeImageAlt(workId, 2, id, '   ')
    await api.updateEpisodeImageAlt(workId, 2, id, '가'.repeat(300))
    expect(repo.updateEpisodeImageAlt).toHaveBeenNthCalledWith(2, workId, 2, id, '', undefined)
    expect(repo.updateEpisodeImageAlt).toHaveBeenCalledTimes(3)
  })

  it('긴 설명·제어 문자·잘못된 식별자는 서버에 보내지 않는다', async () => {
    const { repo, api } = setup()
    await expect(api.updateEpisodeImageAlt(workId, 2, id, '가'.repeat(301))).rejects.toThrow('300자')
    for (const bad of ['줄\n바꿈', '탭\t문자', 'nul\u0000', '끝\u007f']) await expect(api.updateEpisodeImageAlt(workId, 2, id, bad), bad).rejects.toThrow('제어 문자')
    await expect(api.updateEpisodeImageAlt(workId, 2, 'not-a-uuid', '설명')).rejects.toThrow('식별자')
    await expect(api.updateEpisodeImageAlt('demo', 2, id, '설명')).rejects.toThrow('작품')
    await expect(api.updateEpisodeImageAlt(workId, 0, id, '설명')).rejects.toThrow('회차')
    expect(repo.updateEpisodeImageAlt).not.toHaveBeenCalled()
  })
})
