// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { putRelation, type RelationInput } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { RelationPairEditor } from './RelationPairEditor'

afterEach(cleanup)

const card = (section: 'people' | 'places', title: string) => { const setting = newSetting(section); setting.item.title = title; return setting }

/** 편집기가 쓰는 만큼만 갖춘 ViewModel 대역이다. 「동일 인물」을 기록할 회차(identityEpisode)는 소설을 연결한 세계관이면 정한 회차(없으면 null), 연결하지 않았으면 1이다. */
const open = (settings: StudioSetting[], episode: number | null, linked = true) => {
  const applied: RelationInput[][] = []
  const studio = {
    episode, identityEpisode: episode ?? (linked ? null : 1), editing: { settings }, error: '', setRelationDirty: vi.fn(), confirmRelationDiscard: () => true,
    applyRelations: (changes: RelationInput[]) => { applied.push(changes); return true },
  }
  const [source, target] = settings
  render(<RelationPairEditor studio={studio as never} source={source.item.id} target={target.item.id} onClose={vi.fn()} />)
  return applied
}

describe('「동일 인물」 입력', () => {
  it('인물 카드 둘이면 추가한 행에서 본체를 고르고, 고르면 다른 이름 카드가 바뀐다', () => {
    open([card('people', '승상'), card('people', '홍길동')], 4)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    screen.getByText('승상은(는) 홍길동의 다른 이름이에요.')
    fireEvent.change(screen.getByRole('combobox', { name: '동일 인물 1 본체' }), { target: { value: (screen.getByRole('option', { name: '승상' }) as HTMLOptionElement).value } })
    screen.getByText('홍길동은(는) 승상의 다른 이름이에요.')
    screen.getByText('4화부터 독자에게 정체가 드러나요. 세계관을 저장하면 이 회차의 관계로 기록돼요.')
    expect(screen.queryByRole('button', { name: '동일 인물 추가' })).toBeNull() // 한 쌍에는 하나만 둔다
  })

  it('회차를 정한 뒤에는 다른 이름 → 본체 방향의 동일 인물 관계를 적용한다', () => {
    const settings = [card('people', '승상'), card('people', '홍길동')]
    const applied = open(settings, 4)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual([expect.objectContaining({ predicate: 'identity_of', subjectId: settings[0].item.id, targetId: settings[1].item.id, polarity: 'asserted' })])
  })

  it('회차를 정하지 않았으면 적용하지 않고 이유를 알린다', () => {
    const applied = open([card('people', '승상'), card('people', '홍길동')], null)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    expect(applied).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('관계 기준 회차')
  })

  it('인물이 아닌 카드가 끼면 추가할 수 없고 이유를 알린다', () => {
    open([card('people', '승상'), card('places', '북문')], 4)
    expect(screen.queryByRole('button', { name: '동일 인물 추가' })).toBeNull()
    screen.getByText('인물 카드끼리만 「동일 인물」로 이을 수 있어요.')
  })

  it('소설을 연결하지 않은 세계관은 회차를 정하지 않아도 1화로 기록하는 줄 알리고 적용한다', () => {
    const applied = open([card('people', '승상'), card('people', '홍길동')], null, false)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 추가' }))
    screen.getByText('소설을 연결하지 않은 세계관이라 1화 기준으로 기록돼요.')
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    expect(applied).toHaveLength(1)
  })

  it('이어 둔 동일 인물을 지울 때도 회차가 필요하다', () => {
    const [mask, body] = [card('people', '승상'), card('people', '홍길동')]
    const settings = putRelation([mask, body], { subjectId: mask.item.id, targetId: body.item.id, predicate: 'identity_of', polarity: 'asserted' })
    const applied = open(settings, null)
    fireEvent.click(screen.getByRole('button', { name: '동일 인물 1 삭제' }))
    fireEvent.click(screen.getByRole('button', { name: '편집본에 적용' }))
    expect(applied).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('관계 기준 회차')
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
