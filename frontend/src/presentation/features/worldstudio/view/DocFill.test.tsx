// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { DocFillLine } from '../../../../domain/entities/characterDocs'
import { DocFill } from './DocFill'

afterEach(cleanup)

type Fill = Parameters<typeof DocFill>[0]['fill']
const line = (over: Partial<DocFillLine> = {}): DocFillLine => ({ target: 'body', kind: 'description', episode: 2, quote: '키가 작고 얼굴이 검게 탔다.', ...over })
/** 요청 전의 제안 상태. 처리 함수는 호출만 확인하는 대역이다. */
const fillOf = (over: Partial<Fill> = {}): Fill => ({
  consent: false, setConsent: vi.fn(), lock: '', running: false, error: '', proposal: null, busy: false, request: vi.fn(), apply: vi.fn(), decline: vi.fn(), ...over,
})
const asking = () => screen.getByRole<HTMLButtonElement>('button', { name: /^(원고로 채우기 제안|다시 제안받기|다시 시도)$/ })

it('동의하기 전에는 요청할 수 없고, 동의에 체크하면 요청한다', () => {
  const fill = fillOf()
  const { rerender } = render(<DocFill fill={fill} />)
  expect(asking().disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /OpenAI로 보내고/ }))
  expect(fill.setConsent).toHaveBeenCalledWith(true)
  const agreed = fillOf({ consent: true })
  rerender(<DocFill fill={agreed} />)
  expect(asking().disabled).toBe(false)
  fireEvent.click(asking())
  expect(agreed.request).toHaveBeenCalledOnce()
})

it('요청할 수 없는 이유는 버튼과 이어서 보이고 동의해도 버튼은 잠겨 있다', () => {
  render(<DocFill fill={fillOf({ consent: true, lock: '연결된 소설이 없어요. 작품 관리에서 소설을 연결하면 원고로 채울 수 있어요.' })} />)
  expect(asking().disabled).toBe(true)
  const reason = screen.getByText(/연결된 소설이 없어요/)
  expect(asking().getAttribute('aria-describedby')).toBe(reason.id)
})

it('요청하는 동안은 진행을 알리고 동의·요청을 잠근다', () => {
  render(<DocFill fill={fillOf({ consent: true, running: true })} />)
  expect(screen.getByRole('status').textContent).toMatch(/원고에서 근거 문장을 찾고 있어요/)
  expect(asking().disabled).toBe(true)
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
  expect(screen.getByRole('region', { name: '원고로 채우기 제안' }).getAttribute('aria-busy')).toBe('true')
})

it('실패하면 서버 문구를 알림으로 보이고 버튼이 다시 시도로 바뀐다', () => {
  render(<DocFill fill={fillOf({ consent: true, error: '원고로 채우기 제안을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })} />)
  expect(screen.getByRole('alert').textContent).toBe('원고로 채우기 제안을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  expect(asking().textContent).toBe('다시 시도')
})

it('근거가 없으면 제안 없이 그 사실을 알리고 다시 제안받을 수 있다', () => {
  render(<DocFill fill={fillOf({ consent: true, proposal: { lines: [], skipped: 0 } })} />)
  expect(screen.getByRole('status').textContent).toBe('원고에서 근거가 되는 문장을 찾지 못했어요. 직접 써 주세요.')
  expect(screen.queryByRole('button', { name: '초안에 반영' })).toBeNull()
  expect(asking().textContent).toBe('다시 제안받기')
})

it('제안은 회차와 `[표지] 문장` 줄로 보이고, 반영하거나 반영하지 않을 수 있다', () => {
  const fill = fillOf({ consent: true, proposal: { lines: [line(), line({ kind: 'fact', episode: 12, quote: '치삼은 소금장수다.' })], skipped: 2 } })
  render(<DocFill fill={fill} />)
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['2화 [묘사] 키가 작고 얼굴이 검게 탔다.', '12화 [사실] 치삼은 소금장수다.'])
  expect(screen.getByText('원고에서 확인하지 못한 2줄은 뺐어요.')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull() // 제안이 있으면 요청 입력은 숨는다
  fireEvent.click(screen.getByRole('button', { name: '초안에 반영' }))
  expect(fill.apply).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '반영하지 않기' }))
  expect(fill.decline).toHaveBeenCalledOnce()
})

it('저장하는 중에는 초안에 반영할 수 없고 뺀 줄이 없으면 그 안내도 없다', () => {
  render(<DocFill fill={fillOf({ busy: true, proposal: { lines: [line()], skipped: 0 } })} />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '초안에 반영' }).disabled).toBe(true)
  expect(screen.queryByText(/확인하지 못한/)).toBeNull()
})
