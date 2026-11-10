import { describe, expect, it } from 'vitest'

import { OperationsError } from '../entities/operations'
import type { SupportInquiry } from '../entities/supportInquiry'
import type { SupportInquiryRepository } from '../repositories/SupportInquiryRepository'
import { SupportInquiryUseCase } from '../usecases/SupportInquiryUseCase'

const inquiry: SupportInquiry = {
  id: 'q1', memberId: 'm1', category: '계정', title: '제목', body: '본문', status: 'WAITING',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', replies: [],
}

/** 호출 기록만 남기는 Fake Repository. fail을 주면 모든 호출이 그 오류로 실패한다. */
function setup(fail?: Error) {
  const calls: unknown[][] = []
  const record = <T>(name: string, result: T) => async (...args: unknown[]) => { calls.push([name, ...args]); if (fail) throw fail; return result }
  const repository: SupportInquiryRepository = {
    listMine: record('listMine', [inquiry]), create: record('create', undefined), listAll: record('listAll', [inquiry]),
    get: record('get', inquiry), addReply: record('addReply', undefined), updateReply: record('updateReply', undefined), deleteReply: record('deleteReply', undefined),
  }
  return { calls, uc: new SupportInquiryUseCase(repository) }
}
const input = { category: '계정', title: '제목', body: '본문' }

describe('문의 접수 입력 검사', () => {
  it('category·title은 앞뒤 공백을 지우고 본문은 입력 그대로 저장소에 보낸다', async () => {
    const { uc, calls } = setup()
    await uc.create({ category: ' 이용 문의 ', title: '  로그인 질문  ', body: ' 첫 줄\n둘째 줄 ' })
    expect(calls).toEqual([['create', { category: '이용 문의', title: '로그인 질문', body: ' 첫 줄\n둘째 줄 ' }]])
  })

  it.each([
    ['제목이 공백뿐', { ...input, title: '  ' }, '제목과 내용을 입력해 주세요'],
    ['본문이 공백뿐', { ...input, body: '\n ' }, '제목과 내용을 입력해 주세요'],
    ['문의 유형이 공백뿐', { ...input, category: ' ' }, '문의 유형'],
    ['문의 유형이 51자', { ...input, category: '가'.repeat(51) }, '문의 유형'],
    ['제목이 201자', { ...input, title: '가'.repeat(201) }, '제목은 1~200자'],
    ['본문이 20001자', { ...input, body: '가'.repeat(20001) }, '내용은 1~20000자'],
    ['문의 유형에 U+0000', { ...input, category: '계\u0000정' }, '문의 유형'],
    ['제목에 U+0000', { ...input, title: '제\u0000목' }, '제목은 1~200자'],
    ['본문에 U+0000', { ...input, body: '본\u0000문' }, '내용은 1~20000자'],
  ])('%s이면 저장소를 부르지 않고 안내 오류로 거절한다', async (_name, value, message) => {
    const { uc, calls } = setup()
    const error = await uc.create(value).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OperationsError)
    expect((error as OperationsError).message).toContain(message)
    expect(calls).toEqual([])
  })

  it('경계 길이(50·200·20000자)는 허용하고 앞뒤 공백은 길이에 세지 않는다', async () => {
    const { uc, calls } = setup()
    await uc.create({ category: ' ' + '가'.repeat(50) + ' ', title: ' ' + '나'.repeat(200) + ' ', body: '다'.repeat(20000) })
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ category: '가'.repeat(50), title: '나'.repeat(200), body: '다'.repeat(20000) })
  })

  it('저장소 실패는 성공으로 바꾸지 않고 그대로 전달한다', async () => {
    const failure = new OperationsError('로그인이 필요해요.')
    const { uc } = setup(failure)
    await expect(uc.create(input)).rejects.toBe(failure)
  })
})

describe('관리자 답변 입력 검사', () => {
  it('답변 본문은 입력 그대로(줄바꿈·앞뒤 공백 포함) 등록·수정한다', async () => {
    const { uc, calls } = setup()
    await uc.addReply('q1', ' 첫 답변\n내용 ')
    await uc.updateReply('q1', 'p1', '수정 답변\n')
    expect(calls).toEqual([['addReply', 'q1', ' 첫 답변\n내용 '], ['updateReply', 'q1', 'p1', '수정 답변\n']])
  })

  it.each([
    ['공백뿐', '\n  '], ['빈 값', ''], ['20001자', '가'.repeat(20001)], ['U+0000 포함', '답\u0000변'],
  ])('답변이 %s이면 저장소를 부르지 않고 거절한다', async (_name, body) => {
    const { uc, calls } = setup()
    await expect(uc.addReply('q1', body)).rejects.toThrow(new OperationsError('답변은 1~20000자로 입력해 주세요.'))
    await expect(uc.updateReply('q1', 'p1', body)).rejects.toThrow(new OperationsError('답변은 1~20000자로 입력해 주세요.'))
    expect(calls).toEqual([])
  })

  it('20000자 답변은 허용한다', async () => {
    const { uc, calls } = setup()
    await uc.addReply('q1', '가'.repeat(20000))
    expect(calls).toHaveLength(1)
  })

  it('답변 등록·수정·삭제 실패를 성공으로 숨기지 않는다', async () => {
    const failure = new OperationsError('이 작업을 할 권한이 없어요.')
    const { uc } = setup(failure)
    await expect(uc.addReply('q1', '답변')).rejects.toBe(failure)
    await expect(uc.updateReply('q1', 'p1', '답변')).rejects.toBe(failure)
    await expect(uc.deleteReply('q1', 'p1')).rejects.toBe(failure)
  })
})

describe('조회와 삭제 전달', () => {
  it('내 문의·운영 목록(상태 필터)·상세·답변 삭제를 인자 그대로 저장소에 전달한다', async () => {
    const { uc, calls } = setup()
    expect(await uc.listMine()).toEqual([inquiry])
    expect(await uc.listAll(null)).toEqual([inquiry])
    await uc.listAll('WAITING')
    expect(await uc.get('q1')).toEqual(inquiry)
    await uc.deleteReply('q1', 'p1')
    expect(calls).toEqual([['listMine'], ['listAll', null], ['listAll', 'WAITING'], ['get', 'q1'], ['deleteReply', 'q1', 'p1']])
  })

  it('조회 실패도 그대로 전달한다', async () => {
    const failure = new OperationsError('서버 응답 형식을 확인할 수 없어요.')
    const { uc } = setup(failure)
    await expect(uc.listMine()).rejects.toBe(failure)
    await expect(uc.listAll('ANSWERED')).rejects.toBe(failure)
    await expect(uc.get('q1')).rejects.toBe(failure)
  })
})
