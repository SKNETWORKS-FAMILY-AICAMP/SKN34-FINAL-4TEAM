// @vitest-environment jsdom
// React 렌더 회귀: CI 통합 계층에서도 실행한다.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { CharacterSimulation, SimulationTurn } from '../../../domain/entities/characterSimulation'

vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => ({}) } }))

import { SceneCard } from './SceneCard'

afterEach(cleanup)

const turn = (index: number, extra: Partial<SimulationTurn> = {}): SimulationTurn => ({
  index, characterId: `card-${index}`, characterName: index ? '리안' : '카엘', prose: index ? '"저예요."' : '카엘이 문을 열었다.\n그는 *분명히* 웃었다.',
  checks: [{ kind: 'voice_mix', passed: false, detail: '말투가 섞였어요.' }, { kind: 'relation', passed: true, detail: '' }],
  regenerated: 2, evidence: [{ ref: 'card-9', source: 'graph' }, { ref: '3화 발췌', source: 'manuscript' }], ...extra,
})
const scene = (extra: Partial<CharacterSimulation> = {}): CharacterSimulation =>
  ({ mode: 'if', premise: '카엘이 성문을 열었다면?', beats: [], turns: [turn(0), turn(1)], status: 'completed', stopReason: null, ...extra })
const show = (sim: CharacterSimulation) => render(<SceneCard simulation={sim} workId="w1" episode={3} />)

it('머리에 모드와 상태를, IF 모드는 전제를 보이고 턴마다 인물 이름과 원고 서식으로 그린 문단을 보인다', () => {
  const { container } = show(scene())
  const card = screen.getByRole('region', { name: 'IF 전제' })
  expect(within(card).getByText('완료')).toBeTruthy()
  expect(within(card).getByText('카엘이 성문을 열었다면?')).toBeTruthy()
  const turns = within(card).getAllByRole('listitem').filter((li) => li.parentElement?.classList.contains('sim-turns'))
  expect(turns.map((li) => li.querySelector('.sim-who')?.textContent)).toEqual(['카엘', '리안'])
  // 공용 ManuscriptBody가 그린다: 이어진 줄은 한 문단, *기울임*은 em으로 해석하고 본문을 직접 자르지 않는다.
  const body = turns[0].querySelector('.manuscript-body')!
  expect([...body.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['카엘이 문을 열었다.\n그는 분명히 웃었다.'])
  expect(body.querySelector('em')?.textContent).toBe('분명히')
  expect(container.querySelectorAll('.manuscript-body')).toHaveLength(2)
})

it('턴마다 검사·근거는 접혀 있고 펼치면 검사 종류·통과/위반·설명·다시 생성 횟수와 근거 출처를 보인다', () => {
  show(scene())
  const folds = document.querySelectorAll('details')
  expect(folds).toHaveLength(2)
  folds.forEach((fold) => expect(fold.open).toBe(false))
  const first = within(folds[0] as HTMLElement)
  expect(first.getByText('검사·근거 · 통과 1 · 위반 1')).toBeTruthy()
  const checks = first.getAllByRole('listitem').map((li) => li.textContent)
  expect(checks).toContain('말투 섞임 위반 말투가 섞였어요.')
  expect(checks).toContain('호칭·관계 통과')
  expect(first.getByText('다시 생성 2회')).toBeTruthy()
  expect(checks).toContain('설정 그래프 · card-9')
  expect(checks).toContain('원고 발췌 · 3화 발췌')
})

it('근거가 없으면 없다고 알리고 검사가 없는 턴은 통과 0 · 위반 0으로 보인다', () => {
  show(scene({ turns: [turn(0, { checks: [], evidence: [], regenerated: 0 })] }))
  expect(screen.getByText('검사·근거 · 통과 0 · 위반 0')).toBeTruthy()
  expect(screen.getByText('찾은 근거가 없어요.')).toBeTruthy()
})

it('흐름 모드는 끝낸 비트 수를 머리에 보이고 비트마다 상태를 보인다', () => {
  show(scene({
    mode: 'flow', premise: null, status: 'running',
    beats: [{ index: 0, text: '성문 대면', status: 'done' }, { index: 1, text: '협상', status: 'rejected' }, { index: 2, text: '퇴각', status: 'pending' }],
  }))
  const card = screen.getByRole('region', { name: '흐름 비트 진행 1/3' })
  expect(within(card).getByText('진행 중')).toBeTruthy()
  expect(within(card).getAllByRole('listitem').filter((li) => li.parentElement?.classList.contains('sim-beats')).map((li) => li.textContent))
    .toEqual(['성문 대면완료', '협상거부됨', '퇴각대기'])
  expect(within(card).queryByText(/IF 전제/)).toBeNull()
})

it('멈춘 장면은 멈춘 이유와 채팅으로 요청하라는 안내를 보이고 완료로 꾸미지 않는다', () => {
  show(scene({ status: 'stopped', stopReason: '재생성 2회 뒤에도 말투가 섞였어요.' }))
  expect(screen.getByText('멈춤')).toBeTruthy()
  expect(screen.queryByText('완료')).toBeNull()
  expect(screen.getByText('멈춘 이유').parentElement?.textContent).toBe('멈춘 이유 재생성 2회 뒤에도 말투가 섞였어요.')
  expect(screen.getByText('흐름 수정이나 다시 시도는 채팅으로 요청해 주세요.')).toBeTruthy()
})

it('실패한 장면은 이유만 보이고(다시 시도 안내는 멈춤에만), 지금까지의 턴은 그대로 둔다', () => {
  show(scene({ status: 'failed', stopReason: '턴 한도(12)를 넘었어요.', turns: [turn(0)] }))
  expect(screen.getByText('실패')).toBeTruthy()
  expect(screen.getByText('실패 이유').parentElement?.textContent).toBe('실패 이유 턴 한도(12)를 넘었어요.')
  expect(screen.queryByText(/채팅으로 요청/)).toBeNull()
  expect(document.querySelectorAll('.sim-turns > li')).toHaveLength(1)
})

it('만들어진 턴이 없으면 장면이 없다고 알린다', () => {
  show(scene({ turns: [], status: 'running' }))
  expect(screen.getByText('아직 만들어진 장면이 없어요.')).toBeTruthy()
  expect(document.querySelector('.sim-turns')).toBeNull()
})

it('진행 중 새 턴이 오면 카드가 이어서 늘어나고 작가가 펼친 검사·근거는 그대로 펼쳐 둔다', () => {
  const view = show(scene({ status: 'running', turns: [turn(0)] }))
  const first = document.querySelector('details') as HTMLDetailsElement
  first.open = true
  view.rerender(<SceneCard simulation={scene({ status: 'running', turns: [turn(0), turn(1)] })} workId="w1" episode={3} />)
  expect(document.querySelectorAll('.sim-turns > li')).toHaveLength(2)
  expect(document.querySelector('details')).toBe(first)
  expect(first.open).toBe(true)
  expect((document.querySelectorAll('details')[1] as HTMLDetailsElement).open).toBe(false)
})
