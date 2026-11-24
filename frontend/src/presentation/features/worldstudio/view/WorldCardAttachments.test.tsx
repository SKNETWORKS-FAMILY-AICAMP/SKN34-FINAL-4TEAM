// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { WorldCardAttachments } from './WorldCardAttachments'

// 첨부 패널은 자기 테스트(MediaPanel.test)가 맡는다. 여기서는 어떤 대상·잠금으로 붙는지만 본다.
vi.mock('../../../shared/media/MediaPanel', () => ({ MediaPanel: ({ target, disabled }: { target: object; disabled?: boolean }) => <p data-testid="media-panel">{JSON.stringify(target) + (disabled ? ' 잠김' : '')}</p> }))
afterEach(cleanup)

const WORLD = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'
const CARD = '7c9e1f0a-3a51-4d6b-9a39-1f4f2b6d0a02'
const show = (over: { saved?: unknown; supported?: boolean; busy?: boolean } = {}, cardId = CARD) =>
  render(<WorldCardAttachments cardId={cardId} vm={{ saved: { id: WORLD, settings: [{ item: { id: CARD } }] }, cardImages: { supported: true }, busy: false, ...over, ...(over.supported === undefined ? {} : { cardImages: { supported: over.supported } }) } as never} />)

it('서버에 저장된 카드는 그 카드를 대상으로 하는 첨부 패널을 붙인다', () => {
  show()
  expect(screen.getByTestId('media-panel').textContent).toBe(JSON.stringify({ kind: 'card', worldId: WORLD, cardId: CARD }))
})

it('세계관을 저장하는 동안은 첨부 패널을 잠근다', () => {
  show({ busy: true })
  expect(screen.getByTestId('media-panel').textContent).toBe(JSON.stringify({ kind: 'card', worldId: WORLD, cardId: CARD }) + ' 잠김')
})

it('아직 저장하지 않은 새 카드는 패널 대신 저장 뒤에 첨부할 수 있다고 알린다', () => {
  show({}, '4d4f1f0a-3a51-4d6b-9a39-1f4f2b6d0a09')
  expect(screen.queryByTestId('media-panel')).toBeNull()
  expect(screen.getByText('세계관을 저장하면 이 카드에 참고 파일·이미지를 첨부할 수 있어요.')).toBeTruthy()
})

it('서버 저장소가 없는 데모(메모리)는 첨부 자체가 없어 아무것도 그리지 않는다', () => {
  const { container } = show({ supported: false })
  expect(container.innerHTML).toBe('')
})
