// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { Work } from '../../../../domain/entities/content'
import type { ManuscriptImportSummary, ManuscriptPreview } from '../../../../domain/entities/manuscript'

const fakes = vi.hoisted(() => ({ manuscriptUseCase: { preview: vi.fn(), confirm: vi.fn() }, episodeUseCase: { list: vi.fn() } }))
vi.mock('../../../../app/appContainer', () => ({ appContainer: { resolve: (name: keyof typeof fakes) => fakes[name] } }))
vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))

import { ManuscriptImportPage } from './ManuscriptImportPage'

const A = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const work = (id: string, title: string): Work => ({ id, title, summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null, episodes: [], draft: { title: '', body: '', revision: 0 } })
const episode = (title: string, from: number, to: number, extra = {}) => ({ title, from, to, charCount: to - from, excerpt: `${title} 발췌`, imageCount: 0, warnings: [] as string[], ...extra })
const preview: ManuscriptPreview = {
  format: 'txt', unit: 'line', unitCount: 30, existingEpisodeCount: 2,
  episodes: [episode('1화 시작', 0, 10), episode('2화', 10, 20, { imageCount: 2, warnings: ['지원하지 않는 이미지 2개는 빠져요.'] }), episode('3화', 20, 30, { charCount: 41000, warnings: ['본문이 40,000자를 넘어 등록할 수 없어요.'] })],
}
const mixed: ManuscriptImportSummary = { succeeded: 2, failed: 1, results: [
  { number: 1, title: '1화 시작', status: 'versioned', reason: null, missingImages: 0 },
  { number: 2, title: '2화', status: 'partial', reason: '이미지 1개를 가져오지 못했어요.', missingImages: 1 },
  { number: 3, title: '3화', status: 'failed', reason: '본문이 40,000자를 넘어 등록할 수 없어요.', missingImages: 0 },
] }
const RIGHTS = ['이 원고는 내가 쓴 저작물이거나, 등록할 권리를 가지고 있어요.', '출판 계약 등으로 이 원고의 등록·이용이 제한되지 않아요.', '원고에 포함된 이미지를 사용할 권한이 있어요.']
const upload = () => new File(['1화 시작\n본문'], '원고.txt', { type: 'text/plain' })

afterEach(() => { cleanup(); vi.clearAllMocks(); document.title = 'STORYFORK' })

function renderPage(search = `?work=${A}`) {
  fakes.episodeUseCase.list.mockResolvedValue([work(A, '첫 작품'), work(B, '둘째 작품')])
  fakes.manuscriptUseCase.preview.mockResolvedValue(preview)
  fakes.manuscriptUseCase.confirm.mockResolvedValue(mixed)
  return render(<MemoryRouter initialEntries={[`/import${search}`]}><ManuscriptImportPage /></MemoryRouter>)
}
const isLocked = (element: HTMLElement) => element.closest('fieldset')?.disabled
async function toPreview() {
  renderPage()
  const select = await screen.findByLabelText<HTMLSelectElement>('원고를 넣을 작품')
  await waitFor(() => expect(select.value).toBe(A))
  for (const text of RIGHTS) fireEvent.click(screen.getByLabelText(text))
  fireEvent.change(screen.getByLabelText('원고 파일 (.txt, .epub)'), { target: { files: [upload()] } })
  fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
  await screen.findByRole('heading', { name: '미리보기' })
}

it('h1 하나와 건너뛰기 링크가 닿는 main을 가지며 탭 제목에 소설 가져오기를 쓴다', () => {
  renderPage()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['내 소설 가져오기'])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
  expect(document.title).toBe('소설 가져오기 · STORYFORK')
})

it('작품을 고르고 권리 3가지를 확인하기 전에는 파일을 고르거나 미리보기를 보낼 수 없다', async () => {
  renderPage('')
  const select = await screen.findByLabelText<HTMLSelectElement>('원고를 넣을 작품')
  await screen.findByRole('option', { name: '첫 작품' })
  const input = screen.getByLabelText<HTMLInputElement>('원고 파일 (.txt, .epub)')
  expect(input.accept).toBe('.txt,.epub')
  expect(input.disabled).toBe(true)
  fireEvent.change(select, { target: { value: A } })
  expect(input.disabled).toBe(true)
  for (const text of RIGHTS) fireEvent.click(screen.getByLabelText(text))
  expect(input.disabled).toBe(false)
  const button = screen.getByRole('button', { name: '미리보기' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.change(input, { target: { files: [upload()] } })
  expect(button.disabled).toBe(false)
  expect(fakes.manuscriptUseCase.preview).not.toHaveBeenCalled()
})

it('작품 목록을 불러오지 못하면 사유를 알리고 다시 불러올 수 있다', async () => {
  fakes.episodeUseCase.list.mockRejectedValueOnce(new Error('작품을 불러오지 못했어요.'))
  fakes.episodeUseCase.list.mockResolvedValueOnce([work(A, '첫 작품')])
  render(<MemoryRouter initialEntries={['/import']}><ManuscriptImportPage /></MemoryRouter>)
  expect((await screen.findByRole('alert')).textContent).toContain('작품을 불러오지 못했어요.')
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  expect(await screen.findByRole('option', { name: '첫 작품' })).toBeTruthy()
})

it('작품이 하나도 없으면 작품 만들기로 안내한다', async () => {
  fakes.episodeUseCase.list.mockResolvedValue([])
  render(<MemoryRouter initialEntries={['/import']}><ManuscriptImportPage /></MemoryRouter>)
  expect(await screen.findByText(/서버에 저장된 작품이 없어요/)).toBeTruthy()
  expect(screen.getByRole('link', { name: '작품 만들기' }).getAttribute('href')).toBe('/content')
})

it('미리보기는 회차별 제목·글자 수·이미지·경고와 기존 회차 수, 번호별 새 버전 안내를 보여 준다', async () => {
  await toPreview()
  expect(fakes.manuscriptUseCase.preview).toHaveBeenCalledWith(A, expect.any(File), expect.any(AbortSignal))
  expect(screen.getByText(/이 작품에는 이미 2화가 있어요/)).toBeTruthy()
  expect(screen.getByText(/새 저장 버전으로 쌓이며, 발행본은 바뀌지 않아요/)).toBeTruthy()
  expect(screen.getByLabelText<HTMLInputElement>('1번째 회차 제목').value).toBe('1화 시작')
  const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('mi-episode'))
  expect(rows).toHaveLength(3)
  expect(within(rows[0]).getByText('기존 1화에 새 버전으로 쌓여요')).toBeTruthy()
  expect(within(rows[1]).getByText('기존 2화에 새 버전으로 쌓여요')).toBeTruthy()
  expect(within(rows[2]).getByText('3화로 새로 만들어요')).toBeTruthy()
  expect(within(rows[1]).getByText('10자 · 이미지 2개')).toBeTruthy()
  expect(within(rows[1]).getByText('경고: 지원하지 않는 이미지 2개는 빠져요.')).toBeTruthy()
  expect(within(rows[2]).getByText('경고: 본문이 40,000자를 넘어 등록할 수 없어요.')).toBeTruthy()
  expect(within(rows[2]).getByText('41,000자 · 이미지 0개')).toBeTruthy()
  expect(within(rows[0]).getByText('1화 시작 발췌')).toBeTruthy()
  expect(screen.getByRole('button', { name: '3개 회차 등록' })).toBeTruthy()
})

it('제목 수정·제외·합치기가 목록과 확정 버튼에 바로 반영되고 마지막 회차는 합칠 수 없다', async () => {
  await toPreview()
  fireEvent.change(screen.getByLabelText('1번째 회차 제목'), { target: { value: '새 시작' } })
  expect(screen.getByLabelText<HTMLInputElement>('1번째 회차 제목').value).toBe('새 시작')
  expect((screen.getByRole('button', { name: '3번째 회차를 다음 회차와 합치기' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('2번째 회차 제외'))
  expect(screen.getByRole('button', { name: '2개 회차 등록' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '1번째 회차를 다음 회차와 합치기' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('2번째 회차 제외'))
  fireEvent.click(screen.getByRole('button', { name: '1번째 회차를 다음 회차와 합치기' }))
  expect(screen.queryByLabelText('3번째 회차 제목')).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>('1번째 회차 제목').value).toBe('새 시작')
  expect(screen.getByRole('button', { name: '2개 회차 등록' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('2번째 회차 제목'), { target: { value: '  ' } })
  expect((screen.getByRole('button', { name: '2개 회차 등록' }) as HTMLButtonElement).disabled).toBe(true)
})

it('확정은 조정한 목록을 보내고 성공·일부 성공·실패를 따로 보여 주며 전체 성공으로 표시하지 않는다', async () => {
  await toPreview()
  fireEvent.click(screen.getByRole('button', { name: '3개 회차 등록' }))
  await screen.findByRole('heading', { name: '등록 결과' })
  expect(fakes.manuscriptUseCase.confirm).toHaveBeenCalledWith(A, expect.any(File), true, expect.any(Array), expect.any(AbortSignal))
  expect(screen.queryByText('모든 회차를 등록했어요.')).toBeNull()
  expect(screen.getByText(/3개 중 2개를 저장했고 1개는 저장하지 못했어요/)).toBeTruthy()
  const failed = screen.getByRole('alert', { name: '저장하지 못한 회차' })
  expect(within(failed).getByText('3화 · 3화')).toBeTruthy()
  expect(within(failed).getByText('본문이 40,000자를 넘어 등록할 수 없어요.')).toBeTruthy()
  const partial = screen.getByRole('region', { name: '일부만 가져온 회차' })
  expect(within(partial).getByText('이미지 1개를 가져오지 못했어요.')).toBeTruthy()
  const saved = screen.getByRole('region', { name: '저장한 회차' })
  expect(within(saved).getByText('1화 · 1화 시작')).toBeTruthy()
  expect(within(saved).getByText('기존 회차에 새 버전으로 저장했어요')).toBeTruthy()
  expect(screen.getByRole('link', { name: '집필실에서 확인' }).getAttribute('href')).toBe(`/studio/${A}`)
  expect(screen.getByText(/이 화면을 떠나면 다시 볼 수 없어요/)).toBeTruthy()
})

it('모든 회차가 저장됐을 때만 전체 성공으로 알리고, 다른 파일 가져오기는 입력을 비운 설정 화면으로 돌아간다', async () => {
  await toPreview()
  fakes.manuscriptUseCase.confirm.mockResolvedValue({ succeeded: 1, failed: 0, results: [{ number: 3, title: '3화', status: 'created', reason: null, missingImages: 0 }] })
  fireEvent.click(screen.getByRole('button', { name: '3개 회차 등록' }))
  await screen.findByText('모든 회차를 등록했어요.')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다른 파일 가져오기' }))
  const input = await screen.findByLabelText<HTMLInputElement>('원고 파일 (.txt, .epub)')
  expect(input.disabled).toBe(true)
  expect(input.value).toBe('')
  for (const text of RIGHTS) expect(screen.getByLabelText<HTMLInputElement>(text).checked).toBe(false)
})

it('실패 없이 이미지만 빠진 회차가 있어도 전체 성공으로 알리지 않는다', async () => {
  await toPreview()
  fakes.manuscriptUseCase.confirm.mockResolvedValue({ succeeded: 2, failed: 0, results: [
    { number: 1, title: '1화 시작', status: 'created', reason: null, missingImages: 0 },
    { number: 2, title: '2화', status: 'partial', reason: null, missingImages: 2 },
  ] })
  fireEvent.click(screen.getByRole('button', { name: '3개 회차 등록' }))
  await screen.findByRole('heading', { name: '등록 결과' })
  expect(screen.queryByText('모든 회차를 등록했어요.')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText(/2개 중 2개를 저장했고 0개는 저장하지 못했어요/)).toBeTruthy()
  expect(screen.getByText(/이미지를 일부 가져오지 못한 회차가 1개 있어요/)).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '일부만 가져온 회차' })).getByText('이미지 2개를 가져오지 못했어요.')).toBeTruthy()
})

it('미리보기·확정이 실패하면 서버 사유를 알리고 입력과 편집을 그대로 둔다', async () => {
  await toPreview()
  fireEvent.change(screen.getByLabelText('1번째 회차 제목'), { target: { value: '고친 제목' } })
  fakes.manuscriptUseCase.confirm.mockRejectedValueOnce(new Error('회차 번호가 겹쳐요.'))
  fireEvent.click(screen.getByRole('button', { name: '3개 회차 등록' }))
  expect((await screen.findByRole('alert')).textContent).toBe('회차 번호가 겹쳐요.')
  expect(screen.getByLabelText<HTMLInputElement>('1번째 회차 제목').value).toBe('고친 제목')
  expect(screen.queryByRole('heading', { name: '등록 결과' })).toBeNull()
})

it('요청이 진행되는 동안 입력을 잠그고 요청 취소를 보여 주며 완료 문구를 미리 쓰지 않는다', async () => {
  renderPage()
  const select = await screen.findByLabelText<HTMLSelectElement>('원고를 넣을 작품')
  await waitFor(() => expect(select.value).toBe(A))
  for (const text of RIGHTS) fireEvent.click(screen.getByLabelText(text))
  fireEvent.change(screen.getByLabelText('원고 파일 (.txt, .epub)'), { target: { files: [upload()] } })
  let finish!: (value: ManuscriptPreview) => void
  fakes.manuscriptUseCase.preview.mockImplementationOnce(() => new Promise<ManuscriptPreview>((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
  const busy = await screen.findByRole('button', { name: '미리보기를 만드는 중이에요…' })
  expect(isLocked(busy)).toBe(true)
  expect(isLocked(select)).toBe(true)
  const worldLink = screen.getByRole('link', { name: '세계관 만들기' })
  expect(worldLink.getAttribute('aria-disabled')).toBe('true')
  expect(worldLink.hasAttribute('href')).toBe(false)
  expect(screen.getByRole('button', { name: '요청 취소' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '미리보기' })).toBeNull()
  finish(preview)
  await screen.findByRole('heading', { name: '미리보기' })
  expect(screen.getByRole('link', { name: '세계관 만들기' }).getAttribute('href')).toBe('/worldstudio')
  expect(screen.queryByRole('button', { name: '요청 취소' })).toBeNull()
})
