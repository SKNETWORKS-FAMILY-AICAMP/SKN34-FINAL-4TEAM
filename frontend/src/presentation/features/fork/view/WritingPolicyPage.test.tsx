// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { WritingPolicyPage } from './WritingPolicyPage'

vi.mock('../../../shared/shell/Gnb', () => ({ Gnb: () => null, Footer: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

const renderPolicy = (method: 'fork' | 'import') => render(
  <Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={[`/writing-policy?method=${method}`]}><WritingPolicyPage /></MemoryRouter>
  </Provider>,
)

it.each([['fork', '다른 소설 포크 전 확인'], ['import', '내 소설 가져오기 전 확인']] as const)('%s 안내는 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', (method, heading) => {
  renderPolicy(method)
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([heading])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 집필 방식·저작권 안내를 쓴다', () => {
  renderPolicy('import')
  expect(document.title).toBe('집필 방식·저작권 안내 · STORYFORK')
})

it('포크 안내는 설정을 처음 수정하기 전까지 원작을 따라가고, 수정하면 복사해 독립한다고 알린다(DEC-32)', () => {
  renderPolicy('fork')
  const policy = screen.getByRole('heading', { name: '집필 방식과 정책' }).closest('section')!.textContent
  expect(policy).toContain('분기 시점까지 공개된 원고는 그대로 고정돼요')
  expect(policy).toContain('처음 수정하기 전까지는 원작의 변경을 따라가요')
  expect(policy).toContain('처음 수정하면 세계관 전체가 내 것으로 복사되고, 그 뒤의 원작 변경은 들어오지 않아요')
  // 설계와 반대였던 옛 안내: 설정이 분기 시점에 고정되고 원작의 이후 변경이 처음부터 들어오지 않는다.
  expect(policy).not.toContain('세계관·인물 설정은 고정')
  expect(policy).not.toContain('원작의 이후 변경은 기존 포크에 들어오지 않아요')
})
