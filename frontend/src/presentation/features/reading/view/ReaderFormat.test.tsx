// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { imageMarker } from '../../../../domain/entities/media'
import type { Work } from '../../../../domain/entities/work'
import { renderApp } from '../../../../test/renderApp'

const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const work = () => appContainer.resolve('mockDb').works.find((w) => w.id === 'postman')!
const seed = structuredClone(work())
const media = () => appContainer.resolve('mediaUseCase')

// 테스트 파일은 메모리 컨테이너 하나를 공유하므로 고친 작품을 매번 시드로 되돌린다.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  const w = work()
  for (const key of Object.keys(w)) delete (w as Record<string, unknown>)[key]
  Object.assign(w, structuredClone(seed))
})

/** 1화 본문을 바꿔 연다. 정본(canonical) 작품은 서버 회차 댓글을 읽으므로 그 호출만 비운다. */
async function open(paragraphs: string[], patch: Partial<Work> = {}) {
  Object.assign(work(), patch)
  work().eps[0].p = paragraphs
  if (patch.canonical) vi.spyOn(appContainer.resolve('episodeCommentRepository'), 'list').mockResolvedValue([])
  renderApp('/read/postman/1', createAppStore({ role: 'user' }))
  await screen.findByRole('heading', { name: '수취인 불명' })
  return document.getElementById('text')!
}
const sentences = () => [...document.querySelectorAll<HTMLElement>('#text [data-s]')]
/** jsdom에는 URL.createObjectURL이 없다. 이미지 내려받기는 대역이 답하고 호출 인자를 본다. */
function serveImages() {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:image'; static revokeObjectURL = () => {} })
  return vi.spyOn(media(), 'download').mockImplementation(async () => new Blob(['png'], { type: 'image/png' }))
}

describe('회차 뷰어 · 원고 기본 서식', () => {
  it('서식 없는 원고는 전처럼 문단마다 p이고 문장은 빈칸 하나로 이어진다', async () => {
    const text = await open(seed.eps[0].p)
    expect([...text.children].map((el) => el.tagName)).toEqual(['P', 'P', 'P', 'P'])
    expect([...text.children].map((el) => el.textContent)).toEqual(seed.eps[0].p)
    expect(text.querySelector('strong, em, h3, blockquote, hr, br, img')).toBeNull()
    expect(sentences().map((el) => el.dataset.s)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
  })

  it('굵게·기울임·소제목·인용·구분선을 그리고 기호는 보이지 않는다', async () => {
    const text = await open(['## 새벽의 **편지**', '비가 *그친* 새벽이었다. **도윤은 멈췄다.**', '> 집으로.\n> 꼭.', '---', '\\# 소제목이 아닌 줄, 2 * 3 * 4와 <b>태그</b>'])
    expect([...text.children].map((el) => el.tagName)).toEqual(['H3', 'P', 'BLOCKQUOTE', 'HR', 'P'])
    expect(within(text).getByRole('heading', { level: 3 }).textContent).toBe('새벽의 편지')
    expect([...text.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['편지', '도윤은 멈췄다.'])
    expect([...text.querySelectorAll('em')].map((el) => el.textContent)).toEqual(['그친'])
    expect(text.querySelector('blockquote')!.textContent).toBe('집으로.\n꼭.')
    within(text).getByRole('separator')
    // 지원하지 않는 문법과 이스케이프한 줄은 글자 그대로이고 태그는 글자로만 보인다.
    expect(text.lastElementChild!.textContent).toBe('# 소제목이 아닌 줄, 2 * 3 * 4와 <b>태그</b>')
    expect(text.querySelector('b')).toBeNull()
    expect(text.textContent).toBe('새벽의 편지비가 그친 새벽이었다. 도윤은 멈췄다.집으로.\n꼭.# 소제목이 아닌 줄, 2 * 3 * 4와 <b>태그</b>')
  })

  it('문장은 소제목·문단·인용을 이어서 세고 탭 정지점은 하나이며 방향키로 블록을 넘어 옮긴다', async () => {
    await open(['## 새벽', '첫 문장. 둘째 문장.', '---', '> 인용 문장.'])
    const s = sentences()
    expect(s.map((el) => [el.dataset.s, el.textContent])).toEqual([['0', '새벽'], ['1', '첫 문장.'], ['2', '둘째 문장.'], ['3', '인용 문장.']])
    expect(s.filter((el) => el.tabIndex === 0)).toEqual([s[0]])
    expect(s.filter((el) => el.getAttribute('role') === 'button')).toEqual([s[0]])
    act(() => { s[2].focus() })
    fireEvent.keyDown(s[2], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(s[3])
    expect(s.filter((el) => el.getAttribute('role') === 'button')).toEqual([s[3]])
    fireEvent.keyDown(s[3], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(s[3])
  })

  it('서식이 문장 경계를 넘어도 문장마다 굵게 보이고, 수정 제안에 보내는 글은 기호를 포함한 원문 조각이다', async () => {
    const propose = vi.spyOn(appContainer.resolve('editSuggestionUseCase'), 'propose').mockRejectedValue(new Error('대역: 보내지 않음'))
    await open(['**첫 문장이다. 둘째 문장이다.**'], { canonical: true })
    const s = sentences()
    expect(s.map((el) => el.textContent)).toEqual(['첫 문장이다.', '둘째 문장이다.'])
    expect(s.map((el) => el.querySelector('strong')?.textContent)).toEqual(['첫 문장이다.', '둘째 문장이다.'])
    fireEvent.click(s[1])
    fireEvent.click(within(screen.getByRole('dialog', { name: '문장 작업' })).getByRole('button', { name: '✎ 수정 제안' }))
    const dialog = screen.getByRole('dialog', { name: '문장 수정 제안' })
    expect(dialog.querySelector('.quote')!.textContent).toBe('둘째 문장이다.**')
    const box = within(dialog).getByLabelText<HTMLTextAreaElement>('고친 문장')
    expect(box.value).toBe('둘째 문장이다.**')
    fireEvent.change(box, { target: { value: '둘째 문장이었다.**' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '수정 제안 보내기' }))
    await waitFor(() => expect(propose).toHaveBeenCalledWith('postman', 1, { beforeText: '둘째 문장이다.**', afterText: '둘째 문장이었다.**', reason: '' }))
  })

  it('소제목·인용의 문장을 댓글에 인용하면 줄 맨 앞 기호 없이 그 글만 인용한다', async () => {
    await open(['## 1장 *새벽*', '> 그가 말했다.'])
    for (const [k, quote] of [[0, '1장 *새벽*'], [1, '그가 말했다.']] as const) {
      fireEvent.click(sentences()[k])
      fireEvent.click(within(screen.getByRole('dialog', { name: '문장 작업' })).getByRole('button', { name: '💬 댓글 달기' }))
      const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
      expect(dialog.querySelector('.quote')!.textContent).toBe(quote)
      fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    }
  })

  it('문단 안의 줄바꿈은 문장 사이에서도 문장 안에서도 줄바꿈 글자로 남는다', async () => {
    const text = await open(['첫 줄이다.\n둘째 줄\n셋째 줄이다. 넷째.'])
    expect(text.querySelector('p')!.textContent).toBe('첫 줄이다.\n둘째 줄\n셋째 줄이다. 넷째.')
    expect(sentences().map((el) => el.textContent)).toEqual(['첫 줄이다.', '둘째 줄\n셋째 줄이다.', '넷째.'])
  })

  it('빈 줄이 여러 개면 하나를 뺀 만큼 빈 줄을 더 두고, 본문 맨 앞·맨 끝의 빈 줄은 간격을 만들지 않는다', async () => {
    const text = await open('\n\n\n가.\n\n나.\n\n\n\n다.\n\n\n'.split('\n\n'))
    expect([...text.children].map((el) => el.tagName)).toEqual(['P', 'P', 'BR', 'BR', 'P'])
  })

  it('본문 이미지는 공개 작품이면 공개 경로와 공개 설명으로 보이고 문장 순번에 들지 않는다', async () => {
    const download = serveImages()
    const alts = vi.spyOn(media(), 'publicEpisodeImageAlts').mockResolvedValue({ [A]: '강 위의 다리', [B]: '' })
    const text = await open(['앞 문장.', imageMarker(A), imageMarker(B), `뒤 문장. 글 가운데 ${imageMarker(A)} 표식.`], { canonical: true })
    expect(await within(text).findByRole('img', { name: '강 위의 다리' })).toBeTruthy()
    within(text).getByRole('img', { name: '본문 이미지 2' })
    expect(within(text).getAllByRole('img')).toHaveLength(2)
    expect(download.mock.calls.map(([target, id, publicView]) => [target, id, publicView])).toEqual([
      [{ kind: 'episode', workId: 'postman', number: 1 }, A, true],
      [{ kind: 'episode', workId: 'postman', number: 1 }, B, true],
    ])
    expect(alts).toHaveBeenCalledTimes(1)
    expect(alts).toHaveBeenCalledWith('postman', 1, expect.any(AbortSignal))
    // 줄 전체가 표식일 때만 이미지다. 글 가운데 표식은 글자 그대로다.
    expect(sentences().map((el) => el.textContent)).toEqual(['앞 문장.', '뒤 문장.', `글 가운데 ${imageMarker(A)} 표식.`])
  })

  it('작가가 자기 비공개 작품을 미리 읽을 때는 소유자 경로로 받고 공개 설명을 묻지 않는다', async () => {
    const download = serveImages()
    const alts = vi.spyOn(media(), 'publicEpisodeImageAlts')
    const text = await open(['앞 문장.', imageMarker(A)], { canonical: true, private: true, mine: true })
    expect(await within(text).findByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
    expect(download.mock.calls.map(([target, id, publicView]) => [target, id, publicView])).toEqual([[{ kind: 'episode', workId: 'postman', number: 1 }, A, false]])
    expect(alts).not.toHaveBeenCalled()
  })

  it('이미지를 받지 못하면 그 자리에서 알리고 본문은 그대로 읽힌다', async () => {
    vi.spyOn(media(), 'download').mockRejectedValue(new Error('파일이 없거나 조회 권한이 없어요.'))
    vi.spyOn(media(), 'publicEpisodeImageAlts').mockResolvedValue({})
    const text = await open(['앞 문장.', imageMarker(A), '뒤 문장.'], { canonical: true })
    expect((await within(text).findByRole('alert')).textContent).toBe('파일이 없거나 조회 권한이 없어요.')
    expect(sentences().map((el) => el.textContent)).toEqual(['앞 문장.', '뒤 문장.'])
  })
})
