import { describe, expect, it } from 'vitest'

import { OperationsError, OperationsRejected } from '../../domain/entities/operations'
import { InMemoryCardCategoryRepository, InMemoryOperationsCardCategoryRepository } from './InMemoryCardCategoryRepositories'

describe('InMemoryCardCategoryRepositories (서버 없는 시연·테스트용 카드 카테고리)', () => {
  it('기본 8종이 position 순서로 활성 상태·카드 0장으로 시작하고 공개 목록은 같은 값을 숨김 포함으로 준다', async () => {
    const operations = new InMemoryOperationsCardCategoryRepository()
    const rows = await operations.list()
    expect(rows.map((row) => [row.code, row.name, row.position, row.active, row.cardCount])).toEqual([
      ['character', '인물', 1, true, 0], ['location', '장소', 2, true, 0], ['organization', '조직', 3, true, 0], ['ability', '능력', 4, true, 0],
      ['object', '사물', 5, true, 0], ['rule', '규칙', 6, true, 0], ['event', '사건', 7, true, 0], ['other', '기타', 8, true, 0],
    ])
    expect((await new InMemoryCardCategoryRepository(operations).list())[0]).toEqual({ code: 'character', name: '인물', icon: null, position: 1, active: true })
  })

  it('추가는 category-NN 코드로 맨 뒤에 붙고 같은 이름은 거절하며, 숨기기·이름·아이콘 수정은 공개 목록에 바로 이어진다', async () => {
    const operations = new InMemoryOperationsCardCategoryRepository(), publicList = new InMemoryCardCategoryRepository(operations)
    await operations.create({ name: ' 종족 ', icon: '🐉' })
    expect((await operations.list()).at(-1)).toMatchObject({ code: 'category-09', name: '종족', icon: '🐉', position: 9, active: true })
    await expect(operations.create({ name: '인물' })).rejects.toThrow(new OperationsRejected('이미 같은 이름의 카드 카테고리가 있어요.'))
    await operations.update('category-09', { name: '부족', icon: '', active: false })
    expect((await publicList.list()).at(-1)).toEqual({ code: 'category-09', name: '부족', icon: null, position: 9, active: false })
    await expect(operations.update('character', { name: '장소' })).rejects.toBeInstanceOf(OperationsRejected)
    await expect(operations.update('nothing', { active: false })).rejects.toBeInstanceOf(OperationsError)
  })

  it('순서는 전체 코드를 한 번씩 담아야 바꾸고, 빠짐·중복·없는 코드는 거절한다', async () => {
    const operations = new InMemoryOperationsCardCategoryRepository()
    const codes = (await operations.list()).map((row) => row.code)
    await operations.reorder([...codes].reverse())
    expect((await operations.list()).map((row) => row.code)).toEqual([...codes].reverse())
    for (const bad of [codes.slice(1), [...codes, 'character'], [...codes.slice(1), 'nothing']]) await expect(operations.reorder(bad)).rejects.toBeInstanceOf(OperationsError)
  })
})
