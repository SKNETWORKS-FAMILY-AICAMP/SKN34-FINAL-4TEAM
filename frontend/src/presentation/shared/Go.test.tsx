// @vitest-environment jsdom
// React 조립 회귀: CI 통합 계층에서만 실행한다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Go } from './Go'

function Where() {
  const { pathname, state } = useLocation()
  return <output aria-label="현재 경로">{pathname} {JSON.stringify(state)}</output>
}
afterEach(cleanup)

describe('Go의 네이티브 링크 계약', () => {
  it('href·스타일·콜백·라우터 state를 보존한다', () => {
    const clicked = vi.fn()
    render(<MemoryRouter><Go to="/next" state={{ target: '/fork/guunmong' }} className="btn pri" onClick={clicked}>계속</Go><Where /></MemoryRouter>)
    const link = screen.getByRole('link', { name: '계속' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/next')
    expect(link.className).toBe('btn pri')
    fireEvent.click(link)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('현재 경로').textContent).toContain('/next {"target":"/fork/guunmong"}')
  })

  it('수정키 클릭은 기본 링크 동작에 맡기고 콜백의 preventDefault를 존중한다', () => {
    render(<MemoryRouter><Go to="/next">새 탭</Go><Go to="/blocked" onClick={(e) => e.preventDefault()}>취소</Go><Where /></MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name: '새 탭' }), { ctrlKey: true })
    expect(screen.getByLabelText('현재 경로').textContent).toBe('/ null')
    fireEvent.click(screen.getByRole('link', { name: '취소' }))
    expect(screen.getByLabelText('현재 경로').textContent).toBe('/ null')
  })

  it('비활성 회차는 주소·탭 진입·클릭 콜백·탐색이 없는 비활성 링크다', () => {
    const clicked = vi.fn()
    render(<MemoryRouter><Go to="/previous" disabled onClick={clicked}>이전 화</Go><Where /></MemoryRouter>)
    const link = screen.getByRole('link', { name: '이전 화' })
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(link.getAttribute('href')).toBeNull()
    expect(link.tabIndex).toBe(-1)
    fireEvent.click(link)
    fireEvent.keyDown(link, { key: 'Enter' })
    expect(clicked).not.toHaveBeenCalled()
    expect(screen.getByLabelText('현재 경로').textContent).toBe('/ null')
  })
})
