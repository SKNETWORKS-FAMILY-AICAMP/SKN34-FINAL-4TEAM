// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import type { CardCategory } from '../../../../domain/entities/cardCategory'
import { NewCardMenu } from './NewCardMenu'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// 운영자가 기본 카테고리 '인물'을 숨기고 '종족'을 더한 서버 목록.
const server: CardCategory[] = [
  { code: 'character', name: '인물', icon: null, position: 1, active: false },
  { code: 'category-01', name: '종족', icon: '🧬', position: 2, active: true },
]
const studio = { busy: false, addCard: vi.fn(() => 'new-card'), editCard: vi.fn() } as unknown as ComponentProps<typeof NewCardMenu>['vm']

it('카테고리 목록을 읽는 동안은 불러오는 중, 읽지 못하면 기본 8종 대신 실패와 다시 시도를 보이고 다시 읽으면 서버 목록의 활성 카테고리만 고르게 한다', async () => {
  const list = vi.spyOn(appContainer.resolve('cardCategoryUseCase'), 'list').mockRejectedValueOnce(new Error('network')).mockResolvedValue(server)
  render(<Provider store={createAppStore({ role: 'user' })}><NewCardMenu vm={studio} trigger="새 설정" /></Provider>)
  fireEvent.click(screen.getByRole('button', { name: '새 설정' }))
  const menu = within(screen.getByRole('menu', { name: '새 설정' }))
  expect(menu.getByRole('status').textContent).toBe('카드 분류를 불러오고 있어요.')
  expect((await menu.findByRole('alert')).textContent).toBe('카드 분류를 불러오지 못했어요.')
  expect(menu.queryByRole('menuitem', { name: '인물' })).toBeNull() // 기본 8종으로 대신하지 않는다
  fireEvent.click(menu.getByRole('menuitem', { name: '다시 시도' }))
  const species = await menu.findByRole('menuitem', { name: '🧬 종족' })
  expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['🧬 종족']) // 운영자가 숨긴 '인물'은 새로 고를 수 없다
  fireEvent.click(species)
  expect(list).toHaveBeenCalledTimes(2)
  expect(studio.addCard).toHaveBeenCalledWith('category-01')
})
