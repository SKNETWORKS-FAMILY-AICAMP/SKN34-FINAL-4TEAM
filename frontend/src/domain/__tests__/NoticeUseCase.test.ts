import { describe, expect, it, vi } from 'vitest'

import { InMemoryNoticeRepository } from '../../data/mock/InMemoryNoticeRepository'
import { seedNotices } from '../../data/mock/seed'
import { OperationsError, type OperationsNotice } from '../entities/operations'
import type { NoticeRepository } from '../repositories/NoticeRepository'
import { NoticeUseCase } from '../usecases/NoticeUseCase'

const row: OperationsNotice = { id: 'n1', title: '점검 안내', body: '본문', createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z' }
function fake() {
  const repository = {
    list: vi.fn<NoticeRepository['list']>(async () => [row]),
    create: vi.fn<NoticeRepository['create']>(async (input) => ({ ...row, ...input })),
    update: vi.fn<NoticeRepository['update']>(async (id, input) => ({ ...row, id, ...input })),
    delete: vi.fn<NoticeRepository['delete']>(async () => {}),
    listPublic: vi.fn<NoticeRepository['listPublic']>(async () => [row]),
    getPublic: vi.fn<NoticeRepository['getPublic']>(async () => row),
  }
  return { repository, uc: new NoticeUseCase(repository) }
}

describe('NoticeUseCase (Fake Repository)', () => {
  it('제목만 trim하고 본문은 줄바꿈·공백 그대로 새 공지로 등록한다', async () => {
    const { repository, uc } = fake()
    expect(await uc.save(null, { title: ' 점검 안내 ', body: ' 첫 줄\n둘째 줄 ' })).toMatchObject({ title: '점검 안내', body: ' 첫 줄\n둘째 줄 ' })
    expect(repository.create).toHaveBeenCalledWith({ title: '점검 안내', body: ' 첫 줄\n둘째 줄 ' })
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('id가 있으면 같은 검증을 거쳐 전체 수정으로 보낸다', async () => {
    const { repository, uc } = fake()
    expect(await uc.save('n1', { title: ' 수정 ', body: '수정 본문' })).toMatchObject({ id: 'n1', title: '수정' })
    expect(repository.update).toHaveBeenCalledWith('n1', { title: '수정', body: '수정 본문' })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it.each([
    [{ title: ' ', body: '본문' }, '제목은 1~200자로 입력해 주세요.'], [{ title: '가'.repeat(201), body: '본문' }, '제목은 1~200자로 입력해 주세요.'],
    [{ title: '제목', body: '\n ' }, '내용은 1~20000자로 입력해 주세요.'], [{ title: '제목', body: '나'.repeat(20001) }, '내용은 1~20000자로 입력해 주세요.'],
  ])('필수 값과 길이를 서버에 보내기 전에 검사한다: %j', async (input, message) => {
    const { repository, uc } = fake()
    await expect(uc.save(null, input)).rejects.toThrow(new OperationsError(message))
    await expect(uc.save('n1', input)).rejects.toThrow(new OperationsError(message))
    expect(repository.create).not.toHaveBeenCalled()
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('경계 길이(제목 200자·본문 20000자)는 허용한다', async () => {
    const { repository, uc } = fake()
    await uc.save(null, { title: '가'.repeat(200), body: '나'.repeat(20000) })
    expect(repository.create).toHaveBeenCalledTimes(1)
  })

  it('관리자 목록·삭제와 독자 목록·상세는 저장소에 그대로 위임하고 결과를 가리지 않는다', async () => {
    const { repository, uc } = fake()
    expect(await uc.list()).toEqual([row])
    await uc.delete('n1')
    expect(repository.delete).toHaveBeenCalledWith('n1')
    expect(await uc.listPublic()).toEqual([row])
    expect(await uc.getPublic('n1')).toEqual(row)
    repository.getPublic.mockResolvedValueOnce(null)
    expect(await uc.getPublic('missing')).toBeNull()
    repository.listPublic.mockRejectedValueOnce(new OperationsError('실패'))
    await expect(uc.listPublic()).rejects.toThrow('실패')
  })
})

describe('InMemoryNoticeRepository (--mode mockup·테스트 fixture)', () => {
  it('최신순으로 보이고 수정은 id·등록 시각을 지키며 삭제하면 독자 목록에서도 사라진다', async () => {
    const uc = new NoticeUseCase(new InMemoryNoticeRepository())
    expect(await uc.list()).toEqual([])
    const first = await uc.save(null, { title: '첫 공지', body: '본문' })
    await new Promise((done) => setTimeout(done, 2))
    const second = await uc.save(null, { title: '둘째 공지', body: '본문' })
    expect((await uc.listPublic()).map((n) => n.title)).toEqual(['둘째 공지', '첫 공지'])
    const updated = await uc.save(first.id, { title: '수정한 첫 공지', body: '새 본문' })
    expect(updated).toMatchObject({ id: first.id, createdAt: first.createdAt, title: '수정한 첫 공지' })
    expect(await uc.getPublic(first.id)).toEqual(updated)
    await uc.delete(second.id)
    expect((await uc.listPublic()).map((n) => n.id)).toEqual([first.id])
    expect(await uc.getPublic(second.id)).toBeNull()
  })

  it('없는 공지의 수정·삭제는 성공으로 숨기지 않고 안내 오류로 알린다', async () => {
    const uc = new NoticeUseCase(new InMemoryNoticeRepository())
    await expect(uc.save('missing', { title: '제목', body: '본문' })).rejects.toThrow('공지를 찾을 수 없어요')
    await expect(uc.delete('missing')).rejects.toThrow('공지를 찾을 수 없어요')
  })

  it('초기 행을 받아 보여 주되 호출자가 넘긴 배열을 바꾸지 않는다', async () => {
    const seed = [row]
    const uc = new NoticeUseCase(new InMemoryNoticeRepository(seed))
    await uc.save(null, { title: '새 공지', body: '본문' })
    expect(seed).toEqual([row])
    expect((await uc.listPublic()).map((n) => n.title).sort()).toEqual(['새 공지', '점검 안내'])
  })

  it('목업 시드 공지는 기존 4건을 한국시간 날짜 기준 최신순으로 보여 준다', async () => {
    const rows = await new NoticeUseCase(new InMemoryNoticeRepository(seedNotices())).listPublic()
    expect(rows.map((n) => n.title)).toEqual(['STORYFORK 데모 버전 안내', '포크 이용 안내', '댓글·피드백·신고 안내', 'AI 기능 크레딧 정책 안내'])
    expect(rows[0].createdAt).toBe('2026-10-26T15:00:00.000Z')
  })
})
