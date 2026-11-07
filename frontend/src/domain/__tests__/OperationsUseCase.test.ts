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
    expect(await uc.load()).toEqual({ notices: [], events: [], inquiries: [] })
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

  it('운영 문의 category/title/body CRUD와 여러 답변은 단일 회원 문의 모델과 분리된다', async () => {
    const { uc } = setup()
    const q = await uc.saveInquiry(null, { ...text, category: ' 계정 ' })
    expect(q.id).toMatch(uuid)
    expect(await uc.inquiry(q.id)).toMatchObject({ category: '계정', title: '점검 안내', body: text.body })
    await uc.saveInquiry(q.id, { category: '이용 문의', title: '수정 문의', body: '질문\n내용' })
    const r1 = await uc.saveReply(q.id, null, ' 첫 답변\n내용 ')
    const r2 = await uc.saveReply(q.id, null, '후속 답변')
    expect(r1.id).toMatch(uuid)
    expect(await uc.reply(q.id, r1.id)).toMatchObject({ inquiryId: q.id, body: ' 첫 답변\n내용 ' })
    await uc.saveReply(q.id, r1.id, '답변 수정')
    const loaded = (await uc.load()).inquiries[0]
    expect(loaded).toMatchObject({ category: '이용 문의', title: '수정 문의' })
    expect(loaded.replies.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort())
    await expect(uc.deleteInquiry(q.id)).rejects.toThrow('답변을 모두 삭제한 뒤')
    await uc.deleteReply(q.id, r1.id)
    await uc.deleteReply(q.id, r2.id)
    await uc.deleteInquiry(q.id)
    expect((await uc.load()).inquiries).toEqual([])
  })

  it.each(['', ' ', '가'.repeat(51)])('문의 분류의 필수·50자 한도를 지킨다: %s', async (category) => {
    const { uc } = setup()
    await expect(uc.saveInquiry(null, { ...text, category })).rejects.toThrow('분류')
    expect((await uc.load()).inquiries).toEqual([])
  })

  it('문의 및 답변의 최대 길이 경계와 수정 실패 시 기존 기록을 보존한다', async () => {
    const { uc } = setup()
    const q = await uc.saveInquiry(null, { category: '가'.repeat(50), title: '나'.repeat(200), body: '다'.repeat(20000) })
    const reply = await uc.saveReply(q.id, null, '라'.repeat(20000))
    await expect(uc.saveInquiry(q.id, { ...text, category: '분류', body: '가'.repeat(20001) })).rejects.toThrow()
    await expect(uc.saveReply(q.id, reply.id, '나'.repeat(20001))).rejects.toThrow()
    await expect(uc.saveReply(q.id, reply.id, '\n ')).rejects.toThrow()
    expect((await uc.inquiry(q.id)).body).toHaveLength(20000)
    expect((await uc.reply(q.id, reply.id)).body).toHaveLength(20000)
  })

  it('다른 부모 문의의 답변을 조회·수정·삭제할 수 없고 없는 부모에 답변을 만들지 않는다', async () => {
    const { uc } = setup()
    const a = await uc.saveInquiry(null, { ...text, category: '이용' })
    const b = await uc.saveInquiry(null, { ...text, category: '계정' })
    const reply = await uc.saveReply(a.id, null, '유지할 답변')
    await expect(uc.reply(b.id, reply.id)).rejects.toThrow('답변을 찾을 수 없어요')
    await expect(uc.saveReply(b.id, reply.id, '변경')).rejects.toThrow('답변을 찾을 수 없어요')
    await expect(uc.deleteReply(b.id, reply.id)).rejects.toThrow('답변을 찾을 수 없어요')
    await expect(uc.saveReply('없는 부모', null, '내용')).rejects.toThrow('문의를 찾을 수 없어요')
    expect((await uc.reply(a.id, reply.id)).body).toBe('유지할 답변')
  })

  it('사라진 기록을 수정할 때 새 레코드로 되살리지 않는다', async () => {
    const { uc } = setup()
    await expect(uc.saveNotice('없는 공지', text)).rejects.toThrow()
    await expect(uc.saveEvent('없는 이벤트', { ...text, startsAt: null, endsAt: null })).rejects.toThrow()
    await expect(uc.saveInquiry('없는 문의', { ...text, category: '이용' })).rejects.toThrow()
    expect(await uc.load()).toEqual({ notices: [], events: [], inquiries: [] })
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
