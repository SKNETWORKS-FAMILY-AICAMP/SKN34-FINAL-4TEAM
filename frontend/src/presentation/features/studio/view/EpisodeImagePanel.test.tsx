// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { Draft, WritingEpisode } from '../../../../domain/entities/content'
import { imageMarker, type EpisodeImage } from '../../../../domain/entities/media'

const fakes = vi.hoisted(() => ({ mediaUseCase: { listEpisodeImages: vi.fn(), updateEpisodeImageAlt: vi.fn() }, episodeUseCase: { writeEpisode: vi.fn() } }))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: (name: keyof typeof fakes) => fakes[name] } }))

import { EpisodeImagePanel } from './EpisodeImagePanel'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const image = (id: string, filename: string, extra: Partial<EpisodeImage> = {}): EpisodeImage => ({ id, filename, mediaType: 'image/png', byteSize: 2048, altText: '', createdAt: '2026-11-03T10:00:00Z', url: '/unused', referenced: true, ...extra })
const bridge = image(A, '다리.png')
const river = image(B, '강.png', { referenced: false, altText: '맑은 강' })
const draft: Draft = { title: '둘째 화', body: `앞\n\n${imageMarker(A)}\n\n뒤`, revision: 3 }
const writing = (value: Draft): WritingEpisode => ({ number: 2, draft: value, versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'READY', checkpoints: [] })

beforeEach(() => {
  fakes.mediaUseCase.listEpisodeImages.mockResolvedValue([bridge, river])
  fakes.mediaUseCase.updateEpisodeImageAlt.mockImplementation(async (_w: string, _n: number, id: string, altText: string) => image(id, id === A ? '다리.png' : '강.png', { altText: altText.trim() }))
  fakes.episodeUseCase.writeEpisode.mockImplementation(async (_id: string, _n: number, value: Draft) => writing({ ...value, revision: value.revision + 1 }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const panel = (props: Partial<Parameters<typeof EpisodeImagePanel>[0]> = {}) => {
  const onDraftSaved = vi.fn()
  render(<EpisodeImagePanel workId={workId} episode={2} draft={draft} unsaved={false} onDraftSaved={onDraftSaved} {...props} />)
  return { onDraftSaved }
}
const locked = (element: HTMLElement) => element.closest('fieldset')?.disabled

it('이 회차의 이미지를 파일명·크기·본문 사용 여부와 함께 보여 주고 파일은 남겨 둔다고 알린다', async () => {
  panel()
  await screen.findByText('다리.png')
  expect(fakes.mediaUseCase.listEpisodeImages).toHaveBeenCalledWith(workId, 2, expect.any(AbortSignal))
  const [first, second] = screen.getAllByRole('listitem')
  expect(within(first).getByText('2 KiB')).toBeTruthy()
  expect(within(first).getByText('본문에 사용 중')).toBeTruthy()
  expect(within(second).getByText('본문에 없음')).toBeTruthy()
  expect(screen.getByLabelText<HTMLInputElement>('이미지 설명 · 강.png').value).toBe('맑은 강')
  expect(screen.getByLabelText<HTMLInputElement>('이미지 설명 · 다리.png').value).toBe('')
  expect(screen.getByText(/이미지 파일은 저장 버전·발행본을 위해 남겨 둬요/)).toBeTruthy()
})

it('대체 텍스트를 고쳐 저장하면 서버에 보내고 저장했다고 알린다', async () => {
  panel()
  fireEvent.change(await screen.findByLabelText('이미지 설명 · 다리.png'), { target: { value: ' 강 위의 다리 ' } })
  fireEvent.click(screen.getByRole('button', { name: '설명 저장 · 다리.png' }))
  await waitFor(() => expect(fakes.mediaUseCase.updateEpisodeImageAlt).toHaveBeenCalledWith(workId, 2, A, ' 강 위의 다리 ', expect.any(AbortSignal)))
  expect((await screen.findByRole('status')).textContent).toBe('이미지 설명을 저장했어요.')
})

it('대체 텍스트 저장이 실패하면 서버 사유를 알리고 입력한 설명을 그대로 둔다', async () => {
  fakes.mediaUseCase.updateEpisodeImageAlt.mockRejectedValue(new Error('이미지 설명은 300자 이내로 입력해 주세요.'))
  panel()
  const input = await screen.findByLabelText<HTMLInputElement>('이미지 설명 · 다리.png')
  fireEvent.change(input, { target: { value: '저장되지 않은 설명' } })
  fireEvent.click(screen.getByRole('button', { name: '설명 저장 · 다리.png' }))
  expect((await screen.findByRole('alert')).textContent).toBe('이미지 설명은 300자 이내로 입력해 주세요.')
  expect(screen.getByLabelText<HTMLInputElement>('이미지 설명 · 다리.png').value).toBe('저장되지 않은 설명')
  expect(screen.queryByRole('status')).toBeNull()
})

it('본문에서 빼기는 표식을 지운 초안을 저장하고 집필실에 알리며 이미지는 목록에 남긴다', async () => {
  const { onDraftSaved } = panel()
  fireEvent.click(await screen.findByRole('button', { name: '본문에서 빼기 · 다리.png' }))
  await waitFor(() => expect(fakes.episodeUseCase.writeEpisode).toHaveBeenCalledWith(workId, 2, { title: '둘째 화', body: '앞\n\n뒤', revision: 3 }, false, expect.any(AbortSignal)))
  await waitFor(() => expect(onDraftSaved).toHaveBeenCalledTimes(1))
  expect((await screen.findByRole('status')).textContent).toContain('이미지 파일은 저장 버전·발행본을 위해 남겨 두었어요')
  const first = screen.getAllByRole('listitem')[0]
  expect(within(first).getByText('본문에 없음')).toBeTruthy()
  expect((within(first).getByRole('button', { name: '본문에서 빼기 · 다리.png' }) as HTMLButtonElement).disabled).toBe(true)
})

it('저장하지 않은 입력이 있으면 빼기를 막고 먼저 저장하도록 안내하지만 설명 저장은 막지 않는다', async () => {
  panel({ unsaved: true })
  const remove = await screen.findByRole('button', { name: '본문에서 빼기 · 다리.png' }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  expect(screen.getByText(/저장하지 않은 입력이 있거나 저장 중이에요/)).toBeTruthy()
  expect((screen.getByRole('button', { name: '설명 저장 · 다리.png' }) as HTMLButtonElement).disabled).toBe(false)
  expect(fakes.episodeUseCase.writeEpisode).not.toHaveBeenCalled()
})

it('본문에 없는 이미지는 뺄 수 없다', async () => {
  panel()
  expect((await screen.findByRole('button', { name: '본문에서 빼기 · 강.png' }) as HTMLButtonElement).disabled).toBe(true)
})

it('초안 저장이 실패하면 서버 사유와 다시 불러오기 안내를 알리고 집필실에는 알리지 않는다', async () => {
  fakes.episodeUseCase.writeEpisode.mockRejectedValue(new Error('다른 곳에서 원고가 바뀌었어요.'))
  const { onDraftSaved } = panel()
  fireEvent.click(await screen.findByRole('button', { name: '본문에서 빼기 · 다리.png' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('다른 곳에서 원고가 바뀌었어요.')
  expect(alert.textContent).toContain('다시 불러온 뒤')
  expect(onDraftSaved).not.toHaveBeenCalled()
  expect(within(screen.getAllByRole('listitem')[0]).getByText('본문에 사용 중')).toBeTruthy()
})

it('이미지가 없거나 목록을 못 불러오면 그대로 알리고 새로고침으로 다시 읽는다', async () => {
  fakes.mediaUseCase.listEpisodeImages.mockResolvedValueOnce([])
  panel()
  expect(await screen.findByText('이 회차에 올린 이미지가 없어요.')).toBeTruthy()
  fakes.mediaUseCase.listEpisodeImages.mockRejectedValueOnce(new Error('저장소 연결 실패'))
  fireEvent.click(screen.getByRole('button', { name: '이미지 목록 새로고침' }))
  expect((await screen.findByRole('alert')).textContent).toBe('저장소 연결 실패')
  expect(screen.queryByText('이 회차에 올린 이미지가 없어요.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '이미지 목록 새로고침' }))
  expect(await screen.findByText('다리.png')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('목록을 불러오는 동안 불러오는 중이라고 알리고, 저장이 진행되는 동안 행의 입력을 잠근다', async () => {
  let finish!: (value: EpisodeImage) => void
  fakes.mediaUseCase.updateEpisodeImageAlt.mockImplementation(() => new Promise<EpisodeImage>((resolve) => { finish = resolve }))
  panel()
  expect(screen.getByRole('status').textContent).toBe('이미지를 불러오고 있어요…')
  fireEvent.click(await screen.findByRole('button', { name: '설명 저장 · 다리.png' }))
  await waitFor(() => expect(locked(screen.getByLabelText('이미지 설명 · 다리.png'))).toBe(true))
  expect(screen.queryByRole('status')).toBeNull()
  finish(image(A, '다리.png', { altText: '완료' }))
  await waitFor(() => expect(locked(screen.getByLabelText('이미지 설명 · 다리.png'))).toBe(false))
})

it('행의 버튼은 글자를 짧게 두고 파일 이름은 이름(aria-label)으로만 붙여, 긴 파일 이름이 버튼을 늘려 시트를 넘치게 하지 않는다', async () => {
  const long = '아주-긴-파일-이름-'.repeat(8) + '.png'
  fakes.mediaUseCase.listEpisodeImages.mockResolvedValue([image(A, long)])
  panel()
  const save = await screen.findByRole('button', { name: `설명 저장 · ${long}` })
  const remove = screen.getByRole('button', { name: `본문에서 빼기 · ${long}` })
  expect([save.textContent, remove.textContent]).toEqual(['설명 저장', '본문에서 빼기'])
  // 파일 이름은 행 머리에 한 번 보인다.
  expect(screen.getAllByText(long)).toHaveLength(1)
})
