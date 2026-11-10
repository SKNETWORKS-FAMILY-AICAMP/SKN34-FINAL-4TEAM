import { describe, expect, it, vi } from 'vitest'

import { approvalNotice, editedTextError, reasonError, suggestionInputError, suggestionStatus, type EditSuggestion } from '../entities/editSuggestion'
import type { EditSuggestionRepository } from '../repositories/EditSuggestionRepository'
import { EditSuggestionUseCase } from '../usecases/EditSuggestionUseCase'

const suggestion = (extra: Partial<EditSuggestion> = {}): EditSuggestion => ({
  id: 's1', workId: 'w1', workTitle: '별빛 서약', episodeNumber: 3, publishedVersionId: 'v1', source: 'reader', proposerName: '독자',
  beforeText: '않 된다고', afterText: '안 된다고', editedText: null, reason: null, status: 'pending', decisionReason: null,
  applyResult: null, applyFailure: null, appliedVersionId: null, scope: 'auto', scopeReasons: ['단어마다 한 글자 오탈자 수준만 바뀌어요.'],
  mine: false, owner: true, createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})
const setup = () => {
  const repo = {
    create: vi.fn(async () => suggestion()), mine: vi.fn(async () => [suggestion()]), inbox: vi.fn(async () => [suggestion()]),
    saveEditedText: vi.fn(async () => suggestion()), approve: vi.fn(async () => suggestion()),
    reject: vi.fn(async () => suggestion()), hold: vi.fn(async () => suggestion()),
  } satisfies EditSuggestionRepository
  return { repo, useCase: new EditSuggestionUseCase(repo) }
}
const untouched = (repo: ReturnType<typeof setup>['repo']) => Object.values(repo).forEach((fn) => expect(fn).not.toHaveBeenCalled())

describe('수정 제안 입력 검사', () => {
  it('통과하면 null이다', () => {
    expect(suggestionInputError('않 된다고', '안 된다고', '맞춤법')).toBeNull()
    expect(suggestionInputError('않 된다고', '안 된다고')).toBeNull()
    expect(editedTextError('안 된다고요')).toBeNull()
    expect(reasonError('')).toBeNull()
  })

  it('고친 문장은 비어 있거나 500자를 넘거나 원래 문장과 같으면 안내 문구를 돌려준다', () => {
    expect(suggestionInputError('않 된다고', '  ')).toContain('고친 문장을 입력')
    expect(suggestionInputError('않 된다고', '가'.repeat(501))).toContain('500자')
    expect(suggestionInputError('않 된다고', '  않 된다고  ')).toContain('같아요')
    expect(suggestionInputError('않 된다고', ` ${'가'.repeat(500)} `)).toBeNull()
  })

  it('고칠 문장(선택한 문장)이 비었거나 500자를 넘으면 거절한다', () => {
    expect(suggestionInputError('  ', '안 된다고')).toContain('문장')
    expect(suggestionInputError('나'.repeat(501), '안 된다고')).toContain('500자')
  })

  it('사유와 편집안은 길이를 검사한다', () => {
    expect(suggestionInputError('않 된다고', '안 된다고', '가'.repeat(501))).toContain('사유')
    expect(reasonError('가'.repeat(501))).toContain('사유')
    expect(reasonError('가'.repeat(500))).toBeNull()
    expect(editedTextError('   ')).toContain('입력')
    expect(editedTextError('가'.repeat(501))).toContain('500자')
  })
})

describe('수정 제안 상태 표시', () => {
  it('승인 결과(초안 반영·반영 실패)는 승인 상태와 따로 보인다', () => {
    expect(suggestionStatus(suggestion())).toEqual({ label: '검토 대기', tone: 'wait' })
    expect(suggestionStatus(suggestion({ status: 'held' }))).toEqual({ label: '보류', tone: 'wait' })
    expect(suggestionStatus(suggestion({ status: 'rejected' }))).toEqual({ label: '거절됨', tone: 'off' })
    expect(suggestionStatus(suggestion({ status: 'approved', applyResult: 'applied' }))).toEqual({ label: '승인됨 · 초안에 반영됨', tone: 'ok' })
    expect(suggestionStatus(suggestion({ status: 'approved', applyResult: 'failed' }))).toEqual({ label: '승인됨 · 반영 실패', tone: 'wait' })
  })

  it('승인 안내는 초안 반영과 발행을 구분하고 실패는 반영 완료로 안내하지 않는다', () => {
    const applied = approvalNotice(suggestion({ status: 'approved', applyResult: 'applied' }))
    expect(applied).toContain('초안에 반영')
    expect(applied).toContain('발행은 집필실에서')
    const failed = approvalNotice(suggestion({ status: 'approved', applyResult: 'failed', applyFailure: '초안에서 고칠 문장을 찾을 수 없어요.' }))
    expect(failed).toContain('반영하지 못했어요')
    expect(failed).not.toContain('초안에 반영했어요')
  })
})

describe('수정 제안 UseCase', () => {
  it('등록은 앞뒤 공백을 지운 문장과 사유를 보내고 사유가 비면 생략한다', async () => {
    const { repo, useCase } = setup()
    await useCase.propose('w1', 3, { beforeText: ' 않 된다고 ', afterText: '  안 된다고\n', reason: '  맞춤법  ' })
    await useCase.propose('w1', 3, { beforeText: '않 된다고', afterText: '안 된다고', reason: '   ' })
    expect(repo.create).toHaveBeenNthCalledWith(1, 'w1', 3, { beforeText: '않 된다고', afterText: '안 된다고', reason: '맞춤법' })
    expect(repo.create).toHaveBeenNthCalledWith(2, 'w1', 3, { beforeText: '않 된다고', afterText: '안 된다고' })
  })

  it.each([
    ['빈 고친 문장', { beforeText: '않 된다고', afterText: ' ', reason: '' }, '고친 문장을 입력'],
    ['같은 문장', { beforeText: '않 된다고', afterText: '않 된다고', reason: '' }, '같아요'],
    ['긴 사유', { beforeText: '않 된다고', afterText: '안 된다고', reason: '가'.repeat(501) }, '사유'],
  ])('등록은 %s를 저장소 호출 없이 거절한다', async (_name, input, message) => {
    const { repo, useCase } = setup()
    await expect(useCase.propose('w1', 3, input)).rejects.toThrow(message)
    untouched(repo)
  })

  it('목록은 저장소 결과를 그대로 돌려준다', async () => {
    const { repo, useCase } = setup()
    expect(await useCase.mine()).toEqual([suggestion()])
    expect(await useCase.inbox()).toEqual([suggestion()])
    expect(repo.mine).toHaveBeenCalledTimes(1)
    expect(repo.inbox).toHaveBeenCalledTimes(1)
  })

  it('편집안 저장은 공백을 지워 제안의 작품·ID로 보내고 잘못된 입력은 거절한다', async () => {
    const { repo, useCase } = setup()
    await useCase.saveEditedText(suggestion(), '  안 된다고요 ')
    expect(repo.saveEditedText).toHaveBeenCalledWith('w1', 's1', '안 된다고요')
    repo.saveEditedText.mockClear()
    await expect(useCase.saveEditedText(suggestion(), '  ')).rejects.toThrow('입력')
    await expect(useCase.saveEditedText(suggestion(), '가'.repeat(501))).rejects.toThrow('500자')
    expect(repo.saveEditedText).not.toHaveBeenCalled()
  })

  it('승인·보류는 제안의 작품과 ID로 보낸다', async () => {
    const { repo, useCase } = setup()
    await useCase.approve(suggestion())
    await useCase.hold(suggestion())
    expect(repo.approve).toHaveBeenCalledWith('w1', 's1')
    expect(repo.hold).toHaveBeenCalledWith('w1', 's1')
  })

  it('거절 사유는 선택이고 공백을 지우며 길면 거절한다', async () => {
    const { repo, useCase } = setup()
    await useCase.reject(suggestion(), '  톤이 달라요  ')
    await useCase.reject(suggestion(), '   ')
    expect(repo.reject).toHaveBeenNthCalledWith(1, 'w1', 's1', '톤이 달라요')
    expect(repo.reject).toHaveBeenNthCalledWith(2, 'w1', 's1', undefined)
    repo.reject.mockClear()
    await expect(useCase.reject(suggestion(), '가'.repeat(501))).rejects.toThrow('사유')
    expect(repo.reject).not.toHaveBeenCalled()
  })
})
