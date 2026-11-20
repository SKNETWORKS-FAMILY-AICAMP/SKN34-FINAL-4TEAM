import { expect, it } from 'vitest'

import { inheritedCardGroups } from '../entities/content'

it('이어받은 카드를 유형별로 묶어 카드 유형 순서로 두고, 알 수 없는 유형은 지우지 않고 뒤에 원래 이름으로 둔다', () => {
  const card = (id: string, title: string, cardType: string) => ({ id, title, cardType, aliases: [] })
  const gate = card('1', '성문', 'location'), kael = card('2', '카엘', 'character'), relic = card('3', '유물', 'artifact'), rin = card('4', '린', 'character')
  expect(inheritedCardGroups([gate, kael, relic, rin])).toEqual([
    { type: 'character', label: '인물', cards: [kael, rin] },
    { type: 'location', label: '장소', cards: [gate] },
    { type: 'artifact', label: 'artifact', cards: [relic] },
  ])
  expect(inheritedCardGroups([])).toEqual([])
})
