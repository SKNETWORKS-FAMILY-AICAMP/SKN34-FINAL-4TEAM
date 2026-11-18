// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { putRelation, type RelationInput } from '../../../../domain/entities/studioRelations'
import { newSetting, RELATION_FROM_ERROR, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { RelationPairEditor } from './RelationPairEditor'

afterEach(cleanup)

const card = (section: 'people' | 'places', title: string) => { const setting = newSetting(section); setting.item.title = title; return setting }

/**
 * 편집기가 쓰는 만큼만 갖춘 ViewModel 대역이다. 소설을 연결한 세계관(linked)은 관계 행마다 N화부터를 받고(relationFrom, DEC-54 2단계),
 * 「동일 인물」을 끝낼 회차(identityEpisode)는 정한 관계 기준 회차(없으면 null)다. 연결하지 않았으면 칸이 없고 1이다.
 */
const open = (settings: StudioSetting[], episode: number | null, linked = true) => {
  const applied: RelationInput[][] = []
  const studio = {
    episode, identityEpisode: episode ?? (linked ? null : 1), relationFrom: linked, editing: { settings }, error: '', setRelationDirty: vi.fn(), confirmRelationDiscard: () => true,
    applyRelations: (changes: RelationInput[]) => { applied.push(changes); return true },
  }
  const [source, target] = settings
  render(<RelationPairEditor studio={studio as never} source={source.item.id} target={target.item.id} onClose={vi.fn()} />)
  return applied
}
const apply = () => fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
const typeFrom = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })

describe('「동일 인물」 입력', () => {
  it('인물 카드 둘이면 추가한 행에서 본체를 고르고, 고르면 다른 이름 카드가 바뀐다', () => {
    open([card('people', '승상'), card('people', '홍길동')], null)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    screen.getByText('승상은(는) 홍길동의 다른 이름이에요.')
    fireEvent.change(screen.getByRole('combobox', { name: '동일 인물 1 본체' }), { target: { value: (screen.getByRole('option', { name: '승상' }) as HTMLOptionElement).value } })
    screen.getByText('홍길동은(는) 승상의 다른 이름이에요.')
    expect(screen.queryByText(/화부터 독자에게 정체가 드러나요/)).toBeNull() // 몇 화부터인지 적기 전에는 알리지 않는다
    typeFrom('동일 인물 1 시작 회차 화부터', '4')
    screen.getByText('4화부터 독자에게 정체가 드러나요.')
    expect(screen.queryByRole('button', { name: '동일 인물 추가' })).toBeNull() // 한 쌍에는 하나만 둔다
  })

  it('행에 N화부터를 적으면 관계 기준 회차를 정하지 않아도 다른 이름 → 본체 방향의 동일 인물 관계를 그 회차로 적용한다', () => {
    const settings = [card('people', '승상'), card('people', '홍길동')]
    const applied = open(settings, null)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    typeFrom('동일 인물 1 시작 회차 화부터', '4')
    apply()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual([expect.objectContaining({ predicate: 'identity_of', subjectId: settings[0].item.id, targetId: settings[1].item.id, polarity: 'asserted', fromEpisode: 4 })])
  })

  it('N화부터를 적지 않았으면 적용하지 않고, 이유를 알리며 칸에 이어 준다', () => {
    const applied = open([card('people', '승상'), card('people', '홍길동')], null)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: '동일 인물 1 시작 회차 화부터' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0])?.textContent).toBe(RELATION_FROM_ERROR)
    apply()
    expect(applied).toEqual([])
    expect(screen.getByRole('alert').textContent).toBe(RELATION_FROM_ERROR)
  })

  it('인물이 아닌 카드가 끼면 추가할 수 없고 이유를 알린다', () => {
    open([card('people', '승상'), card('places', '북문')], 4)
    expect(screen.queryByRole('button', { name: '동일 인물 추가' })).toBeNull()
    screen.getByText('인물 카드끼리만 「동일 인물」로 이을 수 있어요.')
  })

  it('소설을 연결하지 않은 세계관은 N화부터 칸 없이 1화로 기록하는 줄 알리고 적용한다', () => {
    const applied = open([card('people', '승상'), card('people', '홍길동')], null, false)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    expect(screen.queryByRole('textbox', { name: /시작 회차/ })).toBeNull()
    screen.getByText('소설을 연결하지 않은 세계관이라 1화 기준으로 기록돼요.')
    apply()
    expect(applied).toHaveLength(1)
  })

  it('이어 둔 동일 인물을 지우려면(끝내려면) 관계 기준 회차가 필요하고, 고른 회차에서 끝난다고 알린다', () => {
    const [mask, body] = [card('people', '승상'), card('people', '홍길동')]
    const settings = putRelation([mask, body], { subjectId: mask.item.id, targetId: body.item.id, predicate: 'identity_of', polarity: 'asserted', fromEpisode: 2 })
    const without = open(settings, null)
    screen.getByText(/끝낼 회차를 정한 뒤 다시 열어 주세요/)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 1 삭제' }))
    apply()
    expect(without).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('끝낼 회차')
    cleanup()
    const picked = open(settings, 4)
    screen.getByText('「동일 인물」을 지우면 4화에서 끝나요.')
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 1 삭제' }))
    apply()
    expect(picked).toEqual([[]]) // 끝내는 관계는 행의 회차가 아니라 고른 회차가 정하므로 지우기만 넘긴다
  })

  it('본체 카드가 작가 전용이면 다른 인물이 본체를 알 수 있다고 경고하고, 공개 회차를 정하면 경고하지 않는다', () => {
    const [mask, body] = [card('people', '승상'), card('people', '홍길동')]
    open([mask, body], 4)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    screen.getByText(/작가 전용/)
    cleanup()
    open([mask, { ...body, revealFromEpisode: 2 }], 4)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    expect(screen.queryByText(/작가 전용/)).toBeNull()
  })
})

describe('관계 행의 N화부터 입력 (DEC-54 2단계)', () => {
  const pair = () => [card('people', '가람'), card('people', '나래')]

  it('소설을 연결한 세계관은 실제 관계·감정 행마다 칸이 있고, 아직 쓰지 않은 빈 행은 잘못으로 치지 않는다', () => {
    open(pair(), null)
    for (const name of ['실제 관계 1 시작 회차 화부터', '가람 → 나래 감정 1 시작 회차 화부터', '나래 → 가람 감정 1 시작 회차 화부터']) {
      const field = screen.getByRole<HTMLInputElement>('textbox', { name })
      expect([field.value, field.getAttribute('aria-invalid')]).toEqual(['', 'false'])
      expect(field.getAttribute('inputmode')).toBe('numeric')
    }
  })

  it('설명을 적은 행은 N화부터가 없으면 잘못이라 칸에 이유를 잇고, 적으면 그 회차를 가진 채 적용한다', () => {
    const [garam, narae] = pair()
    const applied = open([garam, narae], null)
    fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), { target: { value: '오랜 친구' } })
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: '실제 관계 1 시작 회차 화부터' })
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0])?.textContent).toBe(RELATION_FROM_ERROR)
    apply()
    expect(applied).toEqual([])
    expect(screen.getByRole('alert').textContent).toBe(RELATION_FROM_ERROR)
    typeFrom('실제 관계 1 시작 회차 화부터', '3')
    expect(field.getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByText(RELATION_FROM_ERROR)).toBeNull()
    apply()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual([expect.objectContaining({ text: '오랜 친구', subjectId: garam.item.id, targetId: narae.item.id, fromEpisode: 3 })])
  })

  it('칸은 숫자만 받고, 0이거나 지워 버린 값은 잘못이다', () => {
    const [garam, narae] = pair()
    const settings = putRelation([garam, narae], { subjectId: garam.item.id, targetId: narae.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '경계한다', fromEpisode: 3 })
    const applied = open(settings, null)
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: '실제 관계 1 시작 회차 화부터' })
    expect(field.value).toBe('3') // 기존 관계는 서버가 준 시작 회차가 채워져 있다
    typeFrom('실제 관계 1 시작 회차 화부터', '3화')
    expect(field.value).toBe('3') // 글자는 걸러 숫자만 남는다
    for (const value of ['0', '']) {
      typeFrom('실제 관계 1 시작 회차 화부터', value)
      expect(field.getAttribute('aria-invalid'), JSON.stringify(value)).toBe('true')
    }
    apply()
    expect(applied).toEqual([])
    typeFrom('실제 관계 1 시작 회차 화부터', '5')
    apply()
    expect(applied[0]).toEqual([expect.objectContaining({ id: settings[2].item.id, fromEpisode: 5 })])
  })

  it('소설을 연결하지 않은 세계관은 칸이 없고 설명만 적어도 적용한다(1화로 저장된다)', () => {
    const applied = open(pair(), null, false)
    expect(screen.queryByRole('textbox', { name: /시작 회차/ })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '실제 관계 1' }), { target: { value: '오랜 친구' } })
    apply()
    expect(applied).toHaveLength(1)
    expect(applied[0][0].fromEpisode).toBeUndefined()
  })
})
