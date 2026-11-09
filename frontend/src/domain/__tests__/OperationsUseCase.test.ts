import { describe, expect, it } from 'vitest'

import { InMemoryOperationsRepository } from '../../data/mock/InMemoryOperationsRepository'
import { toKoreanDateTimeInput, toUtcFromKoreanInput } from '../entities/operations'
import { OperationsUseCase } from '../usecases/OperationsUseCase'

const setup = () => {
  const repository = new InMemoryOperationsRepository()
  return { repository, uc: new OperationsUseCase(repository) }
}
const text = { title: ' 점검 안내 ', body: ' 첫 줄\n둘째 줄 ' }
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

describe('독립 운영 메모리 데모 CRUD', () => {
  it('처음에는 빈 운영 기록을 돌려주며 기존 회원 데모 저장소에 의존하지 않는다', async () => {
    const { uc } = setup()
    expect(await uc.load()).toEqual({ notices: [], events: [] })
  })

  it('공지 UUID 등록·상세·수정·삭제는 본문 공백과 줄바꿈을 보존한다', async () => {
    const { uc } = setup()
    const row = await uc.saveNotice(null, text)
    expect(row.id).toMatch(uuid)
    expect(await uc.notice(row.id)).toMatchObject({ title: '점검 안내', body: text.body })
    const updated = await uc.saveNotice(row.id, { title: '수정 안내', body: '수정\n본문' })
    expect(updated).toMatchObject({ id: row.id, createdAt: row.createdAt, title: '수정 안내', body: '수정\n본문' })
    expect((await uc.load()).notices).toEqual([updated])
    await uc.deleteNotice(row.id)
    await expect(uc.notice(row.id)).rejects.toThrow('공지를 찾을 수 없어요')
  })

  it.each([
    { title: ' ', body: '본문' }, { title: '가'.repeat(201), body: '본문' },
    { title: '제목', body: '\n ' }, { title: '제목', body: '나'.repeat(20001) },
  ])('공지의 필수 값과 원본 길이를 저장 전에 검사한다: %j', async (input) => {
    const { uc } = setup()
    await expect(uc.saveNotice(null, input)).rejects.toThrow()
    expect((await uc.load()).notices).toEqual([])
  })

  it('공지와 이벤트의 200자 제목·20000자 본문 경계를 허용한다', async () => {
    const { uc } = setup()
    const input = { title: '가'.repeat(200), body: '나'.repeat(20000) }
    await expect(uc.saveNotice(null, input)).resolves.toMatchObject(input)
    await expect(uc.saveEvent(null, { ...input, startsAt: null, endsAt: null })).resolves.toMatchObject(input)
  })

  it('이벤트 기간은 선택 UTC 필드로 등록하고 전체 수정에서 비울 수 있다', async () => {
    const { uc } = setup()
    const row = await uc.saveEvent(null, { ...text, startsAt: '2026-11-05T00:00:00.000Z', endsAt: null })
    expect(row.id).toMatch(uuid)
    expect(await uc.event(row.id)).toMatchObject({ startsAt: '2026-11-05T00:00:00.000Z', endsAt: null })
    const updated = await uc.saveEvent(row.id, { ...text, title: '변경', startsAt: null, endsAt: null })
    expect(updated).toMatchObject({ id: row.id, title: '변경', startsAt: null, endsAt: null })
    expect((await uc.load()).events).toEqual([updated])
    await uc.deleteEvent(row.id)
    await expect(uc.event(row.id)).rejects.toThrow('이벤트를 찾을 수 없어요')
  })

  it.each([
    { startsAt: '잘못된 날짜', endsAt: null },
    { startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-05T00:00:00Z' },
    { startsAt: '2026-11-05T09:00', endsAt: null },
    { startsAt: '2026-02-30T00:00:00Z', endsAt: null },
    { startsAt: null, endsAt: '2026-11-05T24:00:00Z' },
  ])('유효하지 않은 UTC 또는 역전 기간을 거절한다: %j', async (period) => {
    const { uc } = setup()
    await expect(uc.saveEvent(null, { ...text, ...period })).rejects.toThrow()
    expect((await uc.load()).events).toEqual([])
  })

  it('사라진 기록을 수정할 때 새 레코드로 되살리지 않는다', async () => {
    const { uc } = setup()
    await expect(uc.saveNotice('없는 공지', text)).rejects.toThrow()
    await expect(uc.saveEvent('없는 이벤트', { ...text, startsAt: null, endsAt: null })).rejects.toThrow()
    expect(await uc.load()).toEqual({ notices: [], events: [] })
  })

  it('조회 복사본을 수정해도 운영 정본은 변하지 않는다', async () => {
    const { uc } = setup()
    const row = await uc.saveNotice(null, text)
    row.title = '오염'
    const loaded = await uc.load()
    loaded.notices[0].body = '오염'
    expect(await uc.notice(row.id)).toMatchObject({ title: '점검 안내', body: text.body })
  })
})

describe('한국시간 이벤트 입력과 UTC 왕복', () => {
  it('브라우저 시간대와 무관하게 KST 입력을 UTC로 바꾸고 빈 값은 null로 보낸다', () => {
    expect(toUtcFromKoreanInput('2026-11-05T09:30')).toBe('2026-11-05T00:30:00.000Z')
    expect(toKoreanDateTimeInput('2026-11-05T00:30:00.000Z')).toBe('2026-11-05T09:30')
    expect(toUtcFromKoreanInput('')).toBeNull()
    expect(toKoreanDateTimeInput(null)).toBe('')
  })

  it.each(['2026-02-30T09:00', '2026-11-05T24:00', '2026-11-05', '임의 기간'])('자동 보정·자유문자열 날짜를 거절한다: %s', (value) => {
    expect(() => toUtcFromKoreanInput(value)).toThrow('날짜')
  })
})
