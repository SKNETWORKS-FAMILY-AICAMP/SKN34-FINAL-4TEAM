import { describe, expect, it, vi } from 'vitest'

import { seedWorks } from '../../data/mock/seed'
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX, canManageNotices, noticeInputError, type WorkNotice } from '../entities/workNotice'
import type { WorkNoticeRepository } from '../repositories/WorkNoticeRepository'
import { WorkNoticeUseCase } from '../usecases/WorkNoticeUseCase'

const NBSP = String.fromCharCode(0xa0)
const notice = (extra: Partial<WorkNotice> = {}): WorkNotice => ({
  id: 'n1', workId: 'w1', category: 'info', title: '연재 일정 안내', body: '본문', pinned: false,
  createdAt: '2026-11-11T01:23:45Z', updatedAt: '2026-11-11T01:23:45Z', ...extra,
})
const setup = () => {
  const repo = {
    list: vi.fn(async () => [notice()]), create: vi.fn(async () => notice()), update: vi.fn(async () => notice()), remove: vi.fn(async () => {}),
  } satisfies WorkNoticeRepository
  return { repo, useCase: new WorkNoticeUseCase(repo) }
}
const untouched = (repo: ReturnType<typeof setup>['repo']) => Object.values(repo).forEach((fn) => expect(fn).not.toHaveBeenCalled())

describe('작품 소식 입력 규칙', () => {
  it('제목·본문은 앞뒤 공백을 지운 뒤 비어 있으면 안내 문구를 돌려준다 (NBSP 포함)', () => {
    expect(noticeInputError({ title: '', body: '내용' })).toContain('제목')
    expect(noticeInputError({ title: ` ${NBSP}\n`, body: '내용' })).toContain('제목')
    expect(noticeInputError({ title: '제목', body: '' })).toContain('내용')
    expect(noticeInputError({ title: '제목', body: `${NBSP} \n ` })).toContain('내용')
    expect(noticeInputError({ title: '제목', body: '내용' })).toBeNull()
  })

  it('제목은 공백을 뺀 200자, 본문은 20,000자까지 허용한다', () => {
    expect(noticeInputError({ title: ` ${'가'.repeat(NOTICE_TITLE_MAX)} `, body: '내용' })).toBeNull()
    expect(noticeInputError({ title: '가'.repeat(NOTICE_TITLE_MAX + 1), body: '내용' })).toContain('200자')
    expect(noticeInputError({ title: '제목', body: ` ${'나'.repeat(NOTICE_BODY_MAX)}\n` })).toBeNull()
    expect(noticeInputError({ title: '제목', body: '나'.repeat(NOTICE_BODY_MAX + 1) })).toContain('20,000자')
  })
})

describe('소식 관리 권한 표시 (서버가 다시 확인한다)', () => {
  const works = seedWorks(0)
  const mine = works.find((w) => w.id === 'starlight')!
  const others = works.find((w) => w.id === 'postman')!
  const server = { ...others, canonical: true, owner: 'member-1', mine: false }

  it('내 작품의 소유자와 운영자만 열린다', () => {
    expect(canManageNotices(mine, 'user', null)).toBe(true)
    expect(canManageNotices(others, 'user', 'member-9')).toBe(false)
    expect(canManageNotices(others, null, null)).toBe(false)
    expect(canManageNotices(others, 'admin', null)).toBe(true)
  })

  it('서버 작품은 소유자 회원 ID가 내 ID와 같을 때 열리고 로그인 전(ID 없음)에는 닫힌다', () => {
    expect(canManageNotices(server, 'user', 'member-1')).toBe(true)
    expect(canManageNotices(server, 'user', 'member-2')).toBe(false)
    expect(canManageNotices(server, null, null)).toBe(false)
    expect(canManageNotices({ ...server, owner: undefined }, 'user', null)).toBe(false)
    expect(canManageNotices(server, 'admin', 'member-2')).toBe(true)
    expect(canManageNotices({ ...server, mine: true }, 'user', null)).toBe(true)
  })
})

describe('작품 소식 UseCase', () => {
  it('작성은 앞뒤 공백을 지운 제목·본문과 분류·고정 여부를 보낸다', async () => {
    const { repo, useCase } = setup()
    const signal = new AbortController().signal
    await useCase.create('w1', { category: 'event', title: '  이벤트 안내 ', body: '\n자세한 내용  ', pinned: true }, signal)
    expect(repo.create).toHaveBeenCalledWith('w1', { category: 'event', title: '이벤트 안내', body: '자세한 내용', pinned: true }, signal)
  })

  it('본문의 내부 줄바꿈·빈 줄은 그대로 두고 앞뒤 공백만 지운다 (작성·수정 모두)', async () => {
    const { repo, useCase } = setup()
    const body = '첫 줄입니다.\n화·금에 올라와요.\n\n\n마지막 줄'
    await useCase.create('w1', { category: 'info', title: '제목', body: `\n  ${body}  \n`, pinned: false })
    await useCase.update(notice({ id: 'n1', workId: 'w1' }), { category: 'info', title: '제목', body: ` ${body}\n`, pinned: false })
    expect(repo.create).toHaveBeenCalledWith('w1', { category: 'info', title: '제목', body, pinned: false }, undefined)
    expect(repo.update).toHaveBeenCalledWith('w1', 'n1', { category: 'info', title: '제목', body, pinned: false }, undefined)
  })

  it.each([
    ['빈 제목', { title: '', body: '내용' }, '제목'],
    ['공백뿐인 제목', { title: `${NBSP} `, body: '내용' }, '제목'],
    ['빈 본문', { title: '제목', body: ' \n' }, '내용'],
    ['201자 제목', { title: '가'.repeat(NOTICE_TITLE_MAX + 1), body: '내용' }, '200자'],
    ['20,001자 본문', { title: '제목', body: '나'.repeat(NOTICE_BODY_MAX + 1) }, '20,000자'],
  ])('작성은 %s을 저장소 호출 없이 거절한다', async (_name, text, message) => {
    const { repo, useCase } = setup()
    await expect(useCase.create('w1', { category: 'info', pinned: false, ...text })).rejects.toThrow(message)
    untouched(repo)
  })

  it('수정은 그 소식의 작품·id로 공백을 지운 전체 내용을 보내고 같은 규칙으로 거절한다', async () => {
    const { repo, useCase } = setup()
    const target = notice({ id: 'n7', workId: 'w7', pinned: true })
    await useCase.update(target, { category: 'hiatus', title: ' 휴재 ', body: ' 쉬어요 ', pinned: false })
    expect(repo.update).toHaveBeenCalledWith('w7', 'n7', { category: 'hiatus', title: '휴재', body: '쉬어요', pinned: false }, undefined)
    repo.update.mockClear()
    await expect(useCase.update(target, { category: 'info', title: ' ', body: '내용', pinned: true })).rejects.toThrow('제목')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('요청 본문에는 분류·제목·본문·고정 여부 네 필드만 싣는다 (소식 전체를 넘겨도 id·시각은 보내지 않는다)', async () => {
    const { repo, useCase } = setup()
    const target = notice({ id: 'n7', workId: 'w7', category: 'event', pinned: true })
    const sent = { category: 'event', title: '연재 일정 안내', body: '본문', pinned: true }
    await useCase.update(target, target)
    await useCase.create('w7', target)
    await useCase.togglePin(notice({ ...target, pinned: false }))
    expect(repo.update).toHaveBeenNthCalledWith(1, 'w7', 'n7', sent, undefined)
    expect(repo.create).toHaveBeenCalledWith('w7', sent, undefined)
    expect(repo.update).toHaveBeenNthCalledWith(2, 'w7', 'n7', sent, undefined)
  })

  it.each([[false, true], [true, false]])('고정 전환(현재 %s)은 나머지 내용을 그대로 두고 pinned만 %s로 바꿔 전체 수정으로 보낸다', async (current, next) => {
    const { repo, useCase } = setup()
    const target = notice({ id: 'n3', workId: 'w3', category: 'event', title: '이벤트', body: '여러 줄\n본문', pinned: current })
    await useCase.togglePin(target)
    expect(repo.update).toHaveBeenCalledWith('w3', 'n3', { category: 'event', title: '이벤트', body: '여러 줄\n본문', pinned: next }, undefined)
  })

  it('저장소 실패는 숨기지 않고 그대로 던진다', async () => {
    const { repo, useCase } = setup()
    repo.create.mockRejectedValueOnce(new Error('작품 소식을 관리할 권한이 없어요.'))
    await expect(useCase.create('w1', { category: 'info', title: '제목', body: '내용', pinned: false })).rejects.toThrow('권한이 없어요')
    repo.update.mockRejectedValueOnce(new Error('소식을 찾을 수 없어요.'))
    await expect(useCase.togglePin(notice())).rejects.toThrow('찾을 수 없어요')
  })
})
