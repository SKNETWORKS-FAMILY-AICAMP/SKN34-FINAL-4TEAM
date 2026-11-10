import { describe, expect, it } from 'vitest'

import { OperationsError } from '../../domain/entities/operations'
import { createMockDb, InMemorySupportInquiryRepository } from './InMemoryRepositories'

const setup = () => new InMemorySupportInquiryRepository(createMockDb())
const input = { category: '계정', title: '제목', body: '본문' }
/** 접수 순서를 만들기 위해 만든 문의의 id를 돌려준다(저장소는 최신순으로 읽는다). */
async function create(repo: InMemorySupportInquiryRepository, title = '제목') {
  await repo.create({ ...input, title })
  return (await repo.listMine())[0]
}

describe('메모리 고객지원 문의 저장소 (목업·통합 테스트용)', () => {
  it('접수한 문의는 답변 대기로 최신순에 쌓이고 상태 필터로 나눠 읽는다', async () => {
    const repo = setup()
    const first = await create(repo, '첫 문의')
    await create(repo, '둘째 문의')
    await repo.addReply(first.id, '답변')
    expect((await repo.listMine()).map((x) => x.title)).toEqual(['둘째 문의', '첫 문의'])
    expect((await repo.listAll(null)).map((x) => x.title)).toEqual(['둘째 문의', '첫 문의'])
    expect((await repo.listAll('WAITING')).map((x) => x.title)).toEqual(['둘째 문의'])
    expect((await repo.listAll('ANSWERED')).map((x) => x.title)).toEqual(['첫 문의'])
    expect(await repo.get(first.id)).toMatchObject({ category: '계정', body: '본문', status: 'ANSWERED' })
  })

  it('답변이 하나라도 있으면 답변 완료이고 모두 지우면 다시 답변 대기이며, 답변은 등록 순이다', async () => {
    const repo = setup()
    const { id } = await create(repo)
    await repo.addReply(id, '첫 답변')
    await repo.addReply(id, '둘째 답변')
    let row = await repo.get(id)
    expect(row.status).toBe('ANSWERED')
    expect(row.replies.map((r) => r.body)).toEqual(['첫 답변', '둘째 답변'])
    await repo.updateReply(id, row.replies[0].id, '수정한 답변')
    await repo.deleteReply(id, row.replies[1].id)
    row = await repo.get(id)
    expect(row.replies.map((r) => r.body)).toEqual(['수정한 답변'])
    expect(row.status).toBe('ANSWERED')
    await repo.deleteReply(id, row.replies[0].id)
    expect(await repo.get(id)).toMatchObject({ status: 'WAITING', replies: [] })
  })

  it('없는 문의와 다른 문의의 답변 id는 안내 오류로 거절하고 상태를 바꾸지 않는다', async () => {
    const repo = setup()
    const a = await create(repo, 'A')
    const b = await create(repo, 'B')
    await repo.addReply(a.id, '유지할 답변')
    const reply = (await repo.get(a.id)).replies[0]
    const message = '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'
    await expect(repo.get('없는 문의')).rejects.toThrow(new OperationsError(message))
    await expect(repo.addReply('없는 문의', '답변')).rejects.toThrow(new OperationsError(message))
    await expect(repo.updateReply(b.id, reply.id, '변경')).rejects.toThrow(new OperationsError(message))
    await expect(repo.deleteReply(b.id, reply.id)).rejects.toThrow(new OperationsError(message))
    expect((await repo.get(a.id)).replies.map((r) => r.body)).toEqual(['유지할 답변'])
    expect(await repo.get(b.id)).toMatchObject({ status: 'WAITING', replies: [] })
  })
})
