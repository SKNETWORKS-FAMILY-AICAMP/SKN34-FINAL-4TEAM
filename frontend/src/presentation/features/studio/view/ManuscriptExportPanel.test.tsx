// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ManuscriptDownload } from '../../../../domain/entities/manuscript'

const fakes = vi.hoisted(() => ({ manuscriptUseCase: { exportManuscript: vi.fn() } }))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: (name: keyof typeof fakes) => fakes[name] } }))

import { ManuscriptExportPanel } from './ManuscriptExportPanel'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const downloads: string[] = []

beforeEach(() => {
  fakes.manuscriptUseCase.exportManuscript.mockResolvedValue({ blob: new Blob(['본문']), filename: '내 작품.epub' })
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:manuscript'; static revokeObjectURL = () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); downloads.length = 0 })

const panel = (props: Partial<Parameters<typeof ManuscriptExportPanel>[0]> = {}) => render(<ManuscriptExportPanel workId={workId} episode={2} inherited={false} {...props} />)
const select = (name: string) => screen.getByLabelText<HTMLSelectElement>(name)

it('형식·범위·원본을 고르고 서버 파일을 내려받는다', async () => {
  panel()
  expect(select('형식').value).toBe('txt')
  expect(select('범위').value).toBe('episode')
  expect(select('원본').value).toBe('draft')
  fireEvent.change(select('형식'), { target: { value: 'epub' } })
  fireEvent.change(select('범위'), { target: { value: 'work' } })
  fireEvent.change(select('원본'), { target: { value: 'published' } })
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  await waitFor(() => expect(downloads).toEqual(['내 작품.epub']))
  expect(fakes.manuscriptUseCase.exportManuscript).toHaveBeenCalledWith(workId, { format: 'epub', source: 'published' }, expect.any(AbortSignal))
  expect((await screen.findByRole('status')).textContent).toBe('내 작품.epub 다운로드를 요청했어요.')
})

it('현재 회차는 TXT 초안이 기본이고 회차 번호를 서버에 보낸다', async () => {
  panel()
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  await waitFor(() => expect(fakes.manuscriptUseCase.exportManuscript).toHaveBeenCalledWith(workId, { format: 'txt', source: 'draft', episode: 2 }, expect.any(AbortSignal)))
})

it('원작 기준(상속) 회차는 현재 회차로 내보낼 수 없어 작품 전체로만 보낸다', async () => {
  panel({ inherited: true })
  expect(select('범위').value).toBe('work')
  expect(screen.getByRole<HTMLOptionElement>('option', { name: '현재 회차' }).disabled).toBe(true)
  expect(screen.getByText(/원작 기준 회차는 내보낼 수 없어요/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  await waitFor(() => expect(fakes.manuscriptUseCase.exportManuscript.mock.calls[0][1]).toEqual({ format: 'txt', source: 'draft' }))
})

it('내보내기에 실패하면 서버 사유를 알리고 다운로드를 만들지 않는다', async () => {
  fakes.manuscriptUseCase.exportManuscript.mockRejectedValue(new Error('내보낼 수 있는 회차가 없어요.'))
  panel()
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  expect((await screen.findByRole('alert')).textContent).toBe('내보낼 수 있는 회차가 없어요.')
  expect(downloads).toEqual([])
  expect(screen.queryByRole('status')).toBeNull()
})

it('요청이 진행되는 동안 선택을 잠그고 취소할 수 있으며 저장 중에는 부모가 잠글 수 있다', async () => {
  let finish!: (value: ManuscriptDownload) => void
  fakes.manuscriptUseCase.exportManuscript.mockImplementation(() => new Promise<ManuscriptDownload>((resolve) => { finish = resolve }))
  panel()
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  const busy = await screen.findByRole('button', { name: '내보내는 중이에요…' })
  expect(busy.closest('fieldset')?.disabled).toBe(true)
  expect(select('형식').closest('fieldset')?.disabled).toBe(true)
  expect(screen.getByRole('button', { name: '내보내기 취소' })).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  finish({ blob: new Blob(['x']), filename: '완료.txt' })
  await waitFor(() => expect(downloads).toEqual(['완료.txt']))
  cleanup()
  panel({ disabled: true })
  expect(screen.getByRole('button', { name: '내보내기' }).closest('fieldset')?.disabled).toBe(true)
})

it('TXT는 이미지를 담지 않고 회차 메모·설정은 포함하지 않는다고 알린다', () => {
  panel()
  expect(screen.getByText(/TXT는 글만 담고 이미지는 빠져요/)).toBeTruthy()
  expect(screen.getByText(/회차 메모·설정은 포함하지 않아요/)).toBeTruthy()
})
