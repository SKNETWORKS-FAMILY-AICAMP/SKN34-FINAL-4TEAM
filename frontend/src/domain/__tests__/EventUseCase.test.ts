import { describe, expect, it } from 'vitest'

import { OperationsError, type EventInput, type OperationsEvent } from '../entities/operations'
import type { EventRepository } from '../repositories/EventRepository'
import { EventUseCase } from '../usecases/EventUseCase'

const ID = '0b6f3e5a-2c9d-4c0e-9a55-1f6f6d1f7a01'
const row: OperationsEvent = {
  id: ID, title: '가을 이벤트', body: '본문', startsAt: '2026-11-08T00:00:00Z', endsAt: null,
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
}
const input: EventInput = { title: ' 가을 이벤트 ', body: ' 첫 줄\n둘째 줄 ', startsAt: '2026-11-08T00:00:00.000Z', endsAt: '2026-11-09T00:00:00.000Z' }

/** 호출 인자만 기록하는 Fake Repository */
function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: EventRepository = {
    listPublic: async () => { calls.push(['listPublic']); return [row] },
    getPublic: async (id) => { calls.push(['getPublic', id]); return row },
    listAdmin: async () => { calls.push(['listAdmin']); return [row] },
    create: async (value) => { calls.push(['create', value]); return row },
    update: async (id, value) => { calls.push(['update', id, value]); return row },
    remove: async (id) => { calls.push(['remove', id]) },
  }
  return { calls, uc: new EventUseCase(repository) }
}

describe('EventUseCase', () => {
  it('새 이벤트는 제목 앞뒤 공백만 정리하고 본문은 그대로 등록한다', async () => {
    const { uc, calls } = setup()
    expect(await uc.save(null, input)).toBe(row)
    expect(calls).toEqual([['create', { title: '가을 이벤트', body: ' 첫 줄\n둘째 줄 ', startsAt: input.startsAt, endsAt: input.endsAt }]])
  })

  it('기존 이벤트는 전체 수정으로 보내며 비운 기간은 null로 전달한다', async () => {
    const { uc, calls } = setup()
    await uc.save(ID, { ...input, startsAt: null, endsAt: null })
    expect(calls).toEqual([['update', ID, { title: '가을 이벤트', body: ' 첫 줄\n둘째 줄 ', startsAt: null, endsAt: null }]])
  })

  it.each([
    [{ title: '   ' }, '제목은 1~200자로 입력해 주세요.'],
    [{ title: '가'.repeat(201) }, '제목은 1~200자로 입력해 주세요.'],
    [{ title: '제\u0000목' }, '제목은 1~200자로 입력해 주세요.'],
    [{ body: ' \n ' }, '내용은 1~20000자로 입력해 주세요.'],
    [{ body: '나'.repeat(20001) }, '내용은 1~20000자로 입력해 주세요.'],
    [{ body: '본\u0000문' }, '내용은 1~20000자로 입력해 주세요.'],
    [{ startsAt: '2026-11-09T00:00:00.000Z', endsAt: '2026-11-08T23:59:59.999Z' }, '종료는 시작과 같거나 늦어야 해요.'],
  ])('잘못된 입력 %o는 요청 없이 거절한다', async (patch, message) => {
    const { uc, calls } = setup()
    await expect(uc.save(null, { ...input, ...patch })).rejects.toThrow(new OperationsError(message))
    await expect(uc.save(ID, { ...input, ...patch })).rejects.toThrow(new OperationsError(message))
    expect(calls).toEqual([])
  })

  it('제목 200자·본문 20000자·종료=시작·기간 없음 경계를 허용한다', async () => {
    const { uc, calls } = setup()
    const edge = { title: '가'.repeat(200), body: '나'.repeat(20000) }
    await uc.save(null, { ...edge, startsAt: '2026-11-08T00:00:00.000Z', endsAt: '2026-11-08T00:00:00.000Z' })
    await uc.save(null, { ...edge, startsAt: null, endsAt: null })
    expect(calls.map(([name]) => name)).toEqual(['create', 'create'])
  })

  it('목록·삭제는 Repository에 그대로 위임한다', async () => {
    const { uc, calls } = setup()
    expect(await uc.listPublic()).toEqual([row])
    expect(await uc.listAdmin()).toEqual([row])
    await uc.remove(ID)
    expect(calls).toEqual([['listPublic'], ['listAdmin'], ['remove', ID]])
  })

  it('독자 상세는 UUID로 조회하고, UUID가 아닌 옛 링크는 요청 없이 없음(null)으로 답한다', async () => {
    const { uc, calls } = setup()
    expect(await uc.getPublic(ID)).toBe(row)
    expect(await uc.getPublic('0')).toBeNull()
    expect(await uc.getPublic('../admin/events')).toBeNull()
    expect(calls).toEqual([['getPublic', ID]])
  })
})
