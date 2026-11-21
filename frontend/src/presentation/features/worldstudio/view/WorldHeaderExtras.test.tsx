// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { ReaderPreviewLink, WorldExportButton } from './WorldHeaderExtras'

const download = vi.hoisted(() => vi.fn())
vi.mock('../../../shared/downloadFile', () => ({ downloadText: download }))
afterEach(() => { cleanup(); download.mockClear() })

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

it('독자 시점 미리보기: 소설을 연결하고 발행한 회차가 있으면 N화까지 읽은 독자의 설정 위키(/work/:id/wiki?upto=N)를 새 탭으로 열고, 초안은 안 보인다고 알린다', () => {
  inRouter(<ReaderPreviewLink workId="w9" episode={7} />)
  const link = screen.getByRole('link', { name: '7화까지 읽은 독자로 보기' }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe('/work/w9/wiki?upto=7')
  expect([link.target, link.rel]).toEqual(['_blank', 'noreferrer'])
  expect(screen.getByText('확정 버전과 발행 회차 기준이라 저장하지 않은 초안은 보이지 않아요')).toBeTruthy()
})

it('소설 연결이 없거나 발행한 회차가 없으면 이유와 함께 잠긴다(링크가 아니다)', () => {
  const view = inRouter(<ReaderPreviewLink workId={null} episode={null} />)
  const locked = screen.getByRole('button', { name: '독자 시점으로 보기' }) as HTMLButtonElement
  expect(locked.disabled).toBe(true)
  expect(locked.getAttribute('aria-describedby')).toBe(screen.getByText('소설을 연결하면 독자 시점으로 볼 수 있어요.').id)
  expect(screen.queryByRole('link')).toBeNull()
  view.unmount()
  inRouter(<ReaderPreviewLink workId="w9" episode={null} />)
  expect(screen.getByText('발행한 회차가 없어요.')).toBeTruthy()
  expect((screen.getByRole('button', { name: '독자 시점으로 보기' }) as HTMLButtonElement).disabled).toBe(true)
})

function world(): StudioWorld {
  const a = newSetting('people'); a.item.title = '길동'; a.item.text = '주인공'
  return { id: 'w1', name: '홍길동전', description: '소개', version: 1, settings: [a] } as StudioWorld
}

it('내보내기 메뉴의 JSON·Markdown은 저장한 세계관을 세계관이름-날짜 파일로 내려받고, 저장하지 않은 변경이 있을 때만 저장된 내용만 내보낸다고 알린다', () => {
  const view = inRouter(<WorldExportButton world={world()} dirty={false} />)
  expect(screen.queryByText('저장된 내용만 내보내요')).toBeNull()
  const button = screen.getByRole('button', { name: /내보내기/ })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu', { name: '내보내기' })
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['JSON', 'Markdown'])
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'JSON' }))
  expect(download).toHaveBeenCalledTimes(1)
  const [name, text, type] = download.mock.calls[0]
  expect(name).toMatch(/^홍길동전-\d{8}\.json$/)
  expect(JSON.parse(text).cards[0].title).toBe('길동')
  expect(type).toMatch(/^application\/json/)
  expect(screen.queryByRole('menu')).toBeNull() // 고르면 닫힌다
  fireEvent.click(button)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }))
  expect(download.mock.calls[1][0]).toMatch(/^홍길동전-\d{8}\.md$/)
  expect(download.mock.calls[1][1]).toContain('### 길동')
  expect(download.mock.calls[1][2]).toMatch(/^text\/markdown/)
  view.rerender(<MemoryRouter><WorldExportButton world={world()} dirty /></MemoryRouter>)
  expect(screen.getByRole('status').textContent).toBe('저장된 내용만 내보내요')
})
