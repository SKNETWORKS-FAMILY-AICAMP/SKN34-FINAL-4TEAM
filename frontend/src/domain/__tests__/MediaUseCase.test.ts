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

const worldId = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'
const cardId = '7c9e1f0a-3a51-4d6b-9a39-1f4f2b6d0a02'
const card = { kind: 'card' as const, worldId, cardId }

describe('세계관 카드 첨부 입력 검사(#735)', () => {
  it('설정 첨부처럼 이미지와 참고 파일을 올리고 교체·이름 변경·삭제한다', async () => {
    const { repo, api } = setup()
    const memo = new File(['메모'], '메모.txt')
    await api.upload(card, memo)
    await api.upload(card, memo, id)
    expect(repo.upload).toHaveBeenNthCalledWith(1, card, memo, undefined, undefined)
    expect(repo.upload).toHaveBeenNthCalledWith(2, card, memo, id, undefined)
    expect(await api.rename(card, id, '새 메모.txt')).toBe(renamed)
    expect(repo.rename).toHaveBeenCalledWith(card, id, '새 메모.txt', undefined)
    api.remove(card, id)
    expect(repo.remove).toHaveBeenCalledWith(card, id, undefined)
  })

  it('서버에 저장된 세계관·카드 UUID가 아니면 어느 동작도 보내지 않는다', async () => {
    const { repo, api } = setup()
    for (const bad of [{ ...card, worldId: 'demo' }, { ...card, cardId: 'card-1' }]) {
      await expect(api.list(bad)).rejects.toThrow('설정 카드')
      await expect(api.upload(bad, new File(['x'], 'a.txt'))).rejects.toThrow('설정 카드')
      await expect(api.rename(bad, id, 'a.txt')).rejects.toThrow('설정 카드')
      expect(() => api.remove(bad, id)).toThrow('설정 카드')
      expect(() => api.download(bad, id)).toThrow('설정 카드')
    }
    for (const call of [repo.list, repo.upload, repo.rename, repo.remove, repo.download]) expect(call).not.toHaveBeenCalled()
  })

  it('파일 형식·크기·이름 규칙은 설정 첨부와 같고 식별자를 확인한다', async () => {
    const { repo, api } = setup()
    await expect(api.upload(card, new File(['x'], 'run.exe'))).rejects.toThrow('PNG·JPEG·TXT·MD·CSV·PDF')
    await expect(api.upload(card, new File([new Uint8Array(10485761)], 'big.pdf'))).rejects.toThrow('10 MiB')
    await expect(api.upload(card, new File(['x'], 'a..b.txt'))).rejects.toThrow('파일 이름')
    await expect(api.rename(card, 'not-a-uuid', '메모.txt')).rejects.toThrow('식별자')
    expect(() => api.remove(card, 'not-a-uuid')).toThrow('식별자')
    expect(repo.upload).not.toHaveBeenCalled()
    expect(repo.rename).not.toHaveBeenCalled()
    expect(repo.remove).not.toHaveBeenCalled()
  })
})
