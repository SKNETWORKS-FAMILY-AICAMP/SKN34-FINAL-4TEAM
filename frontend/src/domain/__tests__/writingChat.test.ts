import { describe, expect, it, vi } from 'vitest'
import type { WritingEpisode } from '../entities/content'
import type { CharacterSimulation } from '../entities/characterSimulation'
import { chatBasis, replyText, stepText, type ChatReply } from '../entities/writingChat'
import type { WritingChatRepository } from '../repositories/WritingChatRepository'
import { WritingChatUseCase } from '../usecases/WritingChatUseCase'

const episode = (number: number, publishedVersionId: string | null) => ({ number, publishedVersionId }) as WritingEpisode

describe('chatBasis', () => {
  it('열린 회차가 발행돼 있으면 그 회차, 아니면 가장 뒤의 발행 회차를 근거로 쓴다', () => {
    const list = [episode(1, 'v1'), episode(2, 'v2'), episode(3, null)]
    expect(chatBasis(list, 1)).toEqual({ episode: 1, episodeVersionId: 'v1' })
    expect(chatBasis(list, 3)).toEqual({ episode: 2, episodeVersionId: 'v2' })
    expect(chatBasis([episode(1, null)], 1)).toBeNull()
  })
})

describe('replyText', () => {
  const reply = (extra: Partial<ChatReply>): ChatReply => ({ status: 'completed', steps: [], missingInputs: [], ...extra })

  it('실행한 단계 결과를 계획 순서로 잇고 실행 전 단계는 뺀다', () => {
    expect(replyText(reply({ steps: [
      { feature: 'story_context', status: 'completed', result: { claims: [{ text: '밤에 닫는다' }], gaps: ['3화 확인 못 함'] } },
      { feature: 'web_research', status: 'not_started' },
    ] }))).toBe('[작품 질문] 밤에 닫는다\n확인 못 함: 3화 확인 못 함')
  })

  it('실패와 반영 결과를 성공처럼 꾸미지 않고 그대로 알린다', () => {
    const text = replyText(reply({ status: 'failed', message: '작업 중 실패가 있어요.', steps: [
      { feature: 'writing_editing', status: 'completed', result: { text: '초안' }, applied: { episode: 2, revision: 5 } },
      { feature: 'web_research', status: 'failed', error: '검색 실패' },
    ] }))
    expect(text).toBe('작업 중 실패가 있어요.\n\n[집필·수정] 초안\n→ 2화 초안에 반영했어요.\n\n[고증 조사] 실패: 검색 실패')
  })
})

describe('인물 시뮬레이션 단계 글', () => {
  const simulation: CharacterSimulation = {
    mode: 'if', premise: '카엘이 성문을 열었다면?', beats: [], status: 'completed', stopReason: null,
    turns: [{ index: 0, characterId: 'c', characterName: '카엘', prose: '카엘이 문을 열었다.', checks: [{ kind: 'premise', passed: true, detail: '' }], regenerated: 0, evidence: [] }],
  }

  it('말풍선에는 본문 대신 한 줄 요약을 쓰고 반영 결과를 잇는다(본문은 장면 카드가 그린다)', () => {
    const reply: ChatReply = { status: 'completed', missingInputs: [], steps: [{ feature: 'character_simulation', status: 'completed', simulation, applied: { episode: 3, revision: 4 } }] }
    expect(replyText(reply)).toBe('[인물 시뮬레이션] 완료 · 장면 1턴 · 검사 통과 1 · 위반 0\n→ 3화 초안에 반영했어요.')
    expect(replyText(reply)).not.toContain('카엘이 문을 열었다.')
  })

  it('끝나지 않은 장면은 상태를 앞에 두고, 실패한 단계는 장면이 있어도 서버 사유를 그대로 알린다', () => {
    expect(stepText({ feature: 'character_simulation', status: 'completed', simulation: { ...simulation, status: 'stopped' } })).toMatch(/^멈춤 · /)
    expect(stepText({ feature: 'character_simulation', status: 'not_started', simulation: { ...simulation, status: 'running' } })).toMatch(/^진행 중 · /)
    expect(stepText({ feature: 'character_simulation', status: 'failed', error: '모델 호출에 실패했어요.', simulation })).toBe('실패: 모델 호출에 실패했어요.')
  })
})

describe('WritingChatUseCase', () => {
  const repository = () => ({ rename: vi.fn(), send: vi.fn() }) as unknown as WritingChatRepository & { rename: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }

  it('빈 제목·빈 메시지는 서버에 보내지 않는다', async () => {
    const repo = repository()
    const chat = new WritingChatUseCase(repo)
    await expect(chat.rename('w', 't', '  ')).rejects.toThrow('대화 제목')
    await expect(chat.send('w', 't', { episode: 1, episodeVersionId: 'v', consent: true, request: ' ' }, () => {})).rejects.toThrow('보낼 내용')
    expect(repo.rename).not.toHaveBeenCalled()
    expect(repo.send).not.toHaveBeenCalled()
    await chat.rename('w', 't', ' 새 제목 ')
    expect(repo.rename).toHaveBeenCalledWith('w', 't', '새 제목')
  })
})


it('shows whether web research confirmed or contradicted a finding', () => {
  const reply: ChatReply = { status: 'completed', missingInputs: [], steps: [
    { feature: 'web_research', status: 'completed', result: { findings: [
      { text: '같은 주장', verdict: 'confirmed', sourceUrls: ['https://example.org'] },
      { text: '같은 주장', verdict: 'conflicting', sourceUrls: ['https://example.org'] },
    ] } },
  ] }
  expect(replyText(reply)).toContain('확인됨 · 같은 주장')
  expect(replyText(reply)).toContain('근거 상충 · 같은 주장')
})
