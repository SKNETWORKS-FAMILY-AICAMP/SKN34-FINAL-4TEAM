import { describe, expect, it, vi } from 'vitest'

import type { ManuscriptPreview } from '../entities/manuscript'
import type { ManuscriptRepository } from '../repositories/ManuscriptRepository'
import { adjustableEpisodes, ManuscriptUseCase, mergeWithNext, toImportItems } from '../usecases/ManuscriptUseCase'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const episode = (title: string, from: number, to: number, extra = {}) => ({ title, from, to, charCount: to - from, excerpt: `${title} 발췌`, imageCount: 0, warnings: [] as string[], ...extra })
const preview: ManuscriptPreview = { format: 'txt', unit: 'line', unitCount: 30, existingEpisodeCount: 2, episodes: [episode('1화', 0, 10), episode('2화', 10, 20), episode('3화', 20, 30)] }
const summary = { succeeded: 1, failed: 0, results: [{ number: 1, title: '1화', status: 'created' as const, reason: null, missingImages: 0 }] }

function setup() {
  const repo = {
    preview: vi.fn(async () => preview),
    confirm: vi.fn(async () => summary),
    exportManuscript: vi.fn(async () => ({ blob: new Blob(['x']), filename: '작품.txt' })),
  } satisfies ManuscriptRepository
  return { repo, api: new ManuscriptUseCase(repo) }
}
const file = (name = '원고.txt', size = 3) => {
  const value = new File(['x'], name)
  Object.defineProperty(value, 'size', { value: size })
  return value
}

describe('원고 미리보기 입력 검사', () => {
  it('서버에 보내기 전에 작품 ID·빈 파일·형식·크기를 거른다', async () => {
    const { repo, api } = setup()
    await expect(api.preview('demo', file())).rejects.toThrow('작품')
    await expect(api.preview(workId, file('원고.txt', 0))).rejects.toThrow('빈 파일')
    await expect(api.preview(workId, file('원고.pdf'))).rejects.toThrow('.txt 또는 .epub')
    await expect(api.preview(workId, file('원고.txt', 10 * 1024 * 1024 + 1))).rejects.toThrow('TXT는 10MB')
    await expect(api.preview(workId, file('책.EPUB', 50 * 1024 * 1024 + 1))).rejects.toThrow('EPUB은 50MB')
    expect(repo.preview).not.toHaveBeenCalled()
  })

  it('한도 안의 TXT·EPUB은 취소 신호와 함께 서버 미리보기를 그대로 돌려준다', async () => {
    const { repo, api } = setup()
    const signal = new AbortController().signal
    expect(await api.preview(workId, file('원고.TXT', 10 * 1024 * 1024), signal)).toBe(preview)
    expect(repo.preview).toHaveBeenCalledWith(workId, expect.any(File), signal)
    await api.preview(workId, file('책.epub', 50 * 1024 * 1024))
    expect(repo.preview).toHaveBeenCalledTimes(2)
  })
})

describe('회차 경계 조정', () => {
  it('미리보기를 제외 표시 없는 조정 목록으로 바꾼다', () => {
    expect(adjustableEpisodes(preview).map((e) => [e.title, e.excluded])).toEqual([['1화', false], ['2화', false], ['3화', false]])
  })

  it('다음 회차와 합치면 첫 회차의 제목을 두고 범위·글자 수·이미지·경고를 합친다', () => {
    const list = adjustableEpisodes({ ...preview, episodes: [episode('1화', 0, 10, { imageCount: 1, warnings: ['지원하지 않는 이미지 1개는 빠져요.'] }), episode('2화', 10, 20, { imageCount: 2, warnings: ['지원하지 않는 이미지 1개는 빠져요.', '다른 경고'] }), episode('3화', 20, 30)] })
    const merged = mergeWithNext(list, 0)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ title: '1화', from: 0, to: 20, charCount: 20, imageCount: 3, excerpt: '1화 발췌', excluded: false, warnings: ['지원하지 않는 이미지 1개는 빠져요.', '다른 경고'] })
    expect(merged[1].title).toBe('3화')
    expect(list).toHaveLength(3)
  })

  it('합친 글자 수가 40,000자를 넘으면 등록할 수 없다는 경고를 한 번만 붙인다', () => {
    const warning = '본문이 40,000자를 넘어 등록할 수 없어요.'
    const list = adjustableEpisodes({ ...preview, episodes: [episode('1화', 0, 10, { charCount: 30000 }), episode('2화', 10, 20, { charCount: 15000 }), episode('3화', 20, 30, { charCount: 41000, warnings: [warning] })] })
    expect(mergeWithNext(list, 0)[0].warnings).toEqual([warning])
    expect(mergeWithNext(mergeWithNext(list, 0), 0)[0].warnings).toEqual([warning])
  })

  it('마지막 회차나 제외한 회차는 합치지 않는다', () => {
    const list = adjustableEpisodes(preview)
    expect(mergeWithNext(list, 2)).toBe(list)
    const excluded = list.map((e, i) => i === 1 ? { ...e, excluded: true } : e)
    expect(mergeWithNext(excluded, 0)).toBe(excluded)
    expect(mergeWithNext(excluded, 1)).toBe(excluded)
  })

  it('확정 번호는 조정 목록의 순서이고 제외한 회차도 번호를 차지한다', () => {
    const list = adjustableEpisodes(preview).map((e, i) => i === 1 ? { ...e, excluded: true } : { ...e, title: `  ${e.title} ` })
    expect(toImportItems(list)).toEqual([{ number: 1, title: '1화', from: 0, to: 10 }, { number: 3, title: '3화', from: 20, to: 30 }])
  })
})

describe('원고 등록 확정 입력 검사', () => {
  it('권리 확인과 조정 목록을 번호가 붙은 요청으로 바꿔 보낸다', async () => {
    const { repo, api } = setup()
    const upload = file()
    const signal = new AbortController().signal
    const list = adjustableEpisodes(preview).map((e, i) => i === 0 ? { ...e, excluded: true } : e)
    expect(await api.confirm(workId, upload, true, list, signal)).toBe(summary)
    expect(repo.confirm).toHaveBeenCalledWith(workId, upload, true, [{ number: 2, title: '2화', from: 10, to: 20 }, { number: 3, title: '3화', from: 20, to: 30 }], signal)
  })

  it('권리 확인·남긴 회차·제목·회차 수를 서버에 보내기 전에 검사한다', async () => {
    const { repo, api } = setup()
    const list = adjustableEpisodes(preview)
    await expect(api.confirm('demo', file(), true, list)).rejects.toThrow('작품')
    await expect(api.confirm(workId, file(), false, list)).rejects.toThrow('권리')
    await expect(api.confirm(workId, file(), true, list.map((e) => ({ ...e, excluded: true })))).rejects.toThrow('하나 이상')
    await expect(api.confirm(workId, file(), true, [{ ...list[0], title: '   ' }])).rejects.toThrow('제목')
    await expect(api.confirm(workId, file(), true, [{ ...list[0], title: 'a'.repeat(121) }])).rejects.toThrow('제목')
    await expect(api.confirm(workId, file(), true, Array.from({ length: 301 }, () => list[0]))).rejects.toThrow('300')
    expect(repo.confirm).not.toHaveBeenCalled()
  })

  it('제외한 회차의 빈 제목은 검사하지 않는다', async () => {
    const { repo, api } = setup()
    const list = adjustableEpisodes(preview).map((e, i) => i === 0 ? { ...e, title: '', excluded: true } : e)
    await api.confirm(workId, file(), true, list)
    expect(repo.confirm).toHaveBeenCalledTimes(1)
  })
})

describe('원고 내보내기 입력 검사', () => {
  it('작품 ID와 회차 번호를 거르고 요청을 그대로 넘긴다', async () => {
    const { repo, api } = setup()
    const signal = new AbortController().signal
    await expect(api.exportManuscript('demo', { format: 'txt', source: 'draft' })).rejects.toThrow('작품')
    await expect(api.exportManuscript(workId, { format: 'txt', source: 'draft', episode: 0 })).rejects.toThrow('회차')
    await expect(api.exportManuscript(workId, { format: 'epub', source: 'published', episode: 1.5 })).rejects.toThrow('회차')
    expect(repo.exportManuscript).not.toHaveBeenCalled()
    await api.exportManuscript(workId, { format: 'epub', source: 'published', episode: 2 }, signal)
    await api.exportManuscript(workId, { format: 'txt', source: 'draft' })
    expect(repo.exportManuscript).toHaveBeenNthCalledWith(1, workId, { format: 'epub', source: 'published', episode: 2 }, signal)
    expect(repo.exportManuscript).toHaveBeenNthCalledWith(2, workId, { format: 'txt', source: 'draft' }, undefined)
  })
})
