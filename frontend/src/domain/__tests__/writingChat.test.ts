import { describe, expect, it, vi } from 'vitest'
import type { WritingEpisode } from '../entities/content'
import type { CharacterSimulation } from '../entities/characterSimulation'
import { chatBasis, cleanScene, PLAN_PICK_HINT, replyText, stepText, type ChatReply, type ReviewFinding, type SceneAction } from '../entities/writingChat'
import type { WritingChatRepository } from '../repositories/WritingChatRepository'
import { WritingChatUseCase } from '../usecases/WritingChatUseCase'

const episode = (number: number, publishedVersionId: string | null) => ({ number, publishedVersionId }) as WritingEpisode

// 근거 회차(지식 상한, 발행된 판본 필요)와 반영 회차(targetEpisode, 작가가 연 회차: 초안이어도 된다)를 분리한다.
// 서버는 targetEpisode ≥ episode(근거)만 받으므로 근거는 열린 회차보다 뒤가 되지 않게 고른다.
describe('chatBasis', () => {
  it('열린 회차가 발행돼 있으면 그 회차가 근거이자 반영 회차다', () => {
    const list = [episode(1, 'v1'), episode(2, 'v2'), episode(3, null)]
    expect(chatBasis(list, 1)).toEqual({ episode: 1, episodeVersionId: 'v1', targetEpisode: 1 })
    expect(chatBasis(list, 2)).toEqual({ episode: 2, episodeVersionId: 'v2', targetEpisode: 2 })
  })

  it('열린 회차가 발행 전 초안이면 그 앞의 가장 뒤 발행 회차가 근거이고 반영 회차는 열린 회차다(5화 초안은 4화까지를 근거로 5화에 반영한다)', () => {
    const list = [episode(3, 'v3'), episode(4, 'v4'), episode(5, null)]
    expect(chatBasis(list, 5)).toEqual({ episode: 4, episodeVersionId: 'v4', targetEpisode: 5 })
  })

  it('열린 회차보다 뒤의 발행 회차는 근거로 쓰지 않는다(근거가 반영 회차보다 뒤가 되면 서버가 거절한다)', () => {
    const list = [episode(1, 'v1'), episode(2, null), episode(3, 'v3')]
    expect(chatBasis(list, 2)).toEqual({ episode: 1, episodeVersionId: 'v1', targetEpisode: 2 })
  })

  it('열린 회차 앞에 발행 회차가 없으면 근거가 없다(채팅을 잠근다)', () => {
    expect(chatBasis([episode(1, null), episode(2, 'v2')], 1)).toBeNull()
    expect(chatBasis([episode(1, null)], 1)).toBeNull()
    expect(chatBasis([], 1)).toBeNull()
  })

  it('열린 회차를 모르거나 목록에 없으면 가장 뒤의 발행 회차를 근거로 하고 반영 회차는 보내지 않는다(서버가 근거 회차와 같게 본다)', () => {
    const list = [episode(1, 'v1'), episode(2, 'v2'), episode(3, null)]
    expect(chatBasis(list)).toEqual({ episode: 2, episodeVersionId: 'v2' })
    expect(chatBasis(list)).not.toHaveProperty('targetEpisode')
    expect(chatBasis(list, 99)).toEqual({ episode: 2, episodeVersionId: 'v2' })
    expect(chatBasis(list, 99)).not.toHaveProperty('targetEpisode')
    expect(chatBasis([episode(1, null)])).toBeNull()
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
    expect(text).toBe('작업 중 실패가 있어요.\n\n[기획·집필·수정] 초안\n→ 2화 초안에 반영했어요.\n\n[고증 조사] 실패: 검색 실패')
  })

  it('기획 결과는 계획마다 비트를 번호로 잇고 참고를 덧붙인다(원고가 아니다)', () => {
    const step = { feature: 'writing_editing', status: 'completed' as const, result: {
      plans: [{ title: '항구의 밤', beats: ['선장이 도착한다.', '카이가 배를 숨긴다.'] }, { title: '추격', beats: ['서윤이 쫓는다.'] }],
      notes: ['10화의 약속은 확정 사건'] } }
    expect(stepText(step)).toBe('계획 1. 항구의 밤\n  1) 선장이 도착한다.\n  2) 카이가 배를 숨긴다.\n계획 2. 추격\n  1) 서윤이 쫓는다.\n참고: 10화의 약속은 확정 사건\n'
      + PLAN_PICK_HINT)
  })

  it('계획 없이 바로 쓴 원고는 반영할 본문만 단계 글로 두고, 말풍선에 사용한 계획을 덧붙인다', () => {
    const step = { feature: 'writing_editing', status: 'completed' as const, result: {
      text: '선장은 항구에 내렸다.', plan: { title: '항구의 밤', beats: ['선장이 도착한다.'] } } }
    expect(stepText(step)).toBe('선장은 항구에 내렸다.')
    expect(replyText(reply({ steps: [step] }))).toBe('[기획·집필·수정] 선장은 항구에 내렸다.\n사용한 계획: 항구의 밤 — 선장이 도착한다.')
  })
})

describe('인물 시뮬레이션 단계 글', () => {
  const simulation: CharacterSimulation = {
    mode: 'if', premise: '카엘이 성문을 열었다면?', beats: [], notes: [], status: 'completed', stopReason: null,
    turns: [{ index: 0, kind: 'character', pov: 'omniscient', characterId: 'c', characterName: '카엘', prose: '카엘이 문을 열었다.', checks: [{ kind: 'premise', passed: true, detail: '' }], regenerated: 0, evidence: [], editedByAuthor: false }],
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

describe('장면 조작 정리(cleanScene)', () => {
  it('끼어들기·고친 글의 앞뒤 공백을 지우고 빈 끼어들기는 보내지 않으며 나머지 필드는 그대로 둔다', () => {
    expect(cleanScene({ action: 'next', note: '  문이 열린다  ' })).toEqual({ action: 'next', note: '문이 열린다' })
    expect(cleanScene({ action: 'next', note: '   ' })).toEqual({ action: 'next' })
    expect(cleanScene({ action: 'next' })).toEqual({ action: 'next' })
    expect(cleanScene({ action: 'redo', turn: 3, note: ' 더 차갑게 ' })).toEqual({ action: 'redo', turn: 3, note: '더 차갑게' })
    expect(cleanScene({ action: 'redo', turn: 0 })).toEqual({ action: 'redo', turn: 0 })
    expect(cleanScene({ action: 'edit', turn: 2, text: ' "왔구나." ' })).toEqual({ action: 'edit', turn: 2, text: '"왔구나."' })
    expect(cleanScene({ action: 'stop' })).toEqual({ action: 'stop' })
  })

  it('서버와 같은 한도(끼어들기 300자·고친 글 2,000자)를 넘기거나 비어 있으면 사유를 던진다', () => {
    expect(() => cleanScene({ action: 'next', note: 'ㅁ'.repeat(301) })).toThrow('끼어들기는 300자까지')
    expect(cleanScene({ action: 'next', note: 'ㅁ'.repeat(300) })).toMatchObject({ action: 'next' })
    expect(() => cleanScene({ action: 'redo', turn: 1, note: 'ㅁ'.repeat(301) })).toThrow('끼어들기는 300자까지')
    expect(() => cleanScene({ action: 'edit', turn: 1, text: '   ' })).toThrow('고친 글이 비어 있어요')
    expect(() => cleanScene({ action: 'edit', turn: 1, text: 'ㅁ'.repeat(2001) })).toThrow('고친 글은 2,000자까지')
    expect(cleanScene({ action: 'edit', turn: 1, text: 'ㅁ'.repeat(2000) })).toMatchObject({ action: 'edit' })
  })

  it.each([-1, 1.5, Number.NaN])('줄 번호(%s)가 0 이상의 정수가 아니면 보내지 않는다', (turn) => {
    expect(() => cleanScene({ action: 'edit', turn, text: '글' })).toThrow('고칠 줄을 찾을 수 없어요')
    expect(() => cleanScene({ action: 'redo', turn })).toThrow('고칠 줄을 찾을 수 없어요')
  })
})

describe('WritingChatUseCase 시뮬레이션 시작', () => {
  const repository = () => ({ send: vi.fn().mockResolvedValue(undefined) }) as unknown as WritingChatRepository & { send: ReturnType<typeof vi.fn> }
  const basis = { episode: 1, episodeVersionId: 'v', consent: true as const }
  const onEvent = () => {}

  it('시작 값을 다듬어 operation과 함께 보낸다', async () => {
    const repo = repository()
    await new WritingChatUseCase(repo).send('w', 't', { ...basis, request: '요약', operation: 'character_simulation', simulation: { mode: 'if', premise: ' 만약 ~했다면? ', characterIds: ['c1', 'c1'] } }, onEvent)
    expect(repo.send).toHaveBeenCalledWith('w', 't', { ...basis, request: '요약', operation: 'character_simulation', simulation: { mode: 'if', premise: '만약 ~했다면?', characterIds: ['c1'] } }, onEvent, undefined, undefined)
  })

  it('한도를 넘기거나 operation 없이 simulation만 오면 서버에 보내지 않는다', async () => {
    const repo = repository()
    const chat = new WritingChatUseCase(repo)
    await expect(chat.send('w', 't', { ...basis, request: '요약', operation: 'character_simulation', simulation: { mode: 'flow', beats: [], characterIds: ['c1'] } }, onEvent)).rejects.toThrow('비트를 하나 이상')
    await expect(chat.send('w', 't', { ...basis, request: '요약', simulation: { mode: 'if', premise: '전제', characterIds: ['c1'] } }, onEvent)).rejects.toThrow('시뮬레이션 시작은 시뮬레이션 기능으로만')
    expect(repo.send).not.toHaveBeenCalled()
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

  it('장면 조작은 다듬어 보내고, 한도를 넘기거나 잘못된 조작은 서버에 보내지 않는다', async () => {
    const repo = repository()
    repo.send.mockResolvedValue(undefined)
    const chat = new WritingChatUseCase(repo)
    const basis = { episode: 1, episodeVersionId: 'v', consent: true as const }
    const scene = (action: SceneAction) => ({ ...basis, resume: { approved: true, scene: action } })
    const onEvent = () => {}
    await chat.send('w', 't', scene({ action: 'next', note: ' 비가 쏟아진다 ' }), onEvent)
    expect(repo.send).toHaveBeenCalledWith('w', 't', scene({ action: 'next', note: '비가 쏟아진다' }), onEvent, undefined, undefined)
    await expect(chat.send('w', 't', scene({ action: 'edit', turn: 1, text: ' ' }), onEvent)).rejects.toThrow('고친 글이 비어 있어요')
    await expect(chat.send('w', 't', scene({ action: 'redo', turn: -1 }), onEvent)).rejects.toThrow('고칠 줄을 찾을 수 없어요')
    expect(repo.send).toHaveBeenCalledTimes(1)
    // 승인·거절 응답은 장면 조작 검사를 거치지 않고 그대로 간다.
    await chat.send('w', 't', { ...basis, resume: { approved: false } }, onEvent)
    expect(repo.send).toHaveBeenLastCalledWith('w', 't', { ...basis, resume: { approved: false } }, onEvent, undefined, undefined)
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

describe('원고 검수 결과 글(#59)', () => {
  const finding: ReviewFinding = { category: 'spelling', quote: '웃엇다', reason: '받침 오류', status: 'confirmed', evidenceRefs: [], suggestion: '웃었다', start: 3, end: 6 }
  const step = (findings: ReviewFinding[], gaps: string[] = []) => ({ feature: 'review', status: 'completed' as const,
    review: { check: 'mechanical' as const, episode: 3, revision: 4, findings, gaps } })

  it('지적마다 상태·분류·원문 구절·이유·제안을 보이고, 위치를 정하지 못한 구절은 여러 곳이라고 알린다', () => {
    const text = stepText(step([finding, { ...finding, status: 'suspected', start: null, end: null, category: 'repetition' }], ['날짜 비교 대상 없음']))
    expect(text).toContain('3화 초안 맞춤법·표기 검수')
    expect(text).toContain('확정 · 맞춤법 · "웃엇다"\n이유: 받침 오류\n제안: 웃었다')
    expect(text).toContain('의심 · 중복 표현 · "웃엇다" (여러 곳)')
    expect(text).toContain('확인 못 함: 날짜 비교 대상 없음')
  })

  it('문제가 없으면 없다고 말하고 검수 단계 이름을 붙인다', () => {
    expect(stepText(step([]))).toBe('3화 초안 맞춤법·표기 검수: 찾은 문제가 없어요.')
    expect(replyText({ status: 'completed', missingInputs: [], steps: [step([])] })).toMatch(/^\[원고 검수\] /)
  })

  it('건너뛴 조건부 수정은 실패가 아니라 건너뛴 이유로 보인다(#370)', () => {
    expect(stepText({ feature: 'writing_editing', status: 'skipped', error: '검수에서 고칠 문제를 찾지 못해 수정하지 않았어요.' }))
      .toBe('건너뜀: 검수에서 고칠 문제를 찾지 못해 수정하지 않았어요.')
  })

  it('심의 등급은 제안이라고 밝히고 회차 판정과 수준 2 이상 근거, 판별 실패를 보인다', () => {
    const rating = { verdict: 'adult' as const, prohibited: true, episodes: [
      { episode: 3, verdict: 'adult' as const, prohibited: true, error: null, assessments: [
        { criterion: 'sexual', level: 3, quotes: ['구절'], rationale: '노골적 묘사' },
        { criterion: 'language', level: 1, quotes: [], rationale: '욕설 한 번' }] },
      { episode: 4, verdict: null, prohibited: false, error: '심의 판별 모델 응답을 확인할 수 없습니다.', assessments: [] }] }
    const text = replyText({ status: 'completed', missingInputs: [], steps: [{ feature: 'rating', status: 'completed', rating }] })
    expect(text).toMatch(/^\[심의 등급\] 판정 제안: 19세 이용가 · 금지 표현 의심\(운영 검토 대상\)/)
    expect(text).toContain('3화: 19세 이용가\n선정성 수준 3 · 노골적 묘사 · "구절"')
    expect(text).not.toContain('욕설 한 번')
    expect(text).toContain('4화: 판별 실패 · 심의 판별 모델 응답을 확인할 수 없습니다.')
  })

  it('검토가 필요한 판정은 AI가 정하지 않고 작가에게 근거를 보고 직접 판단하도록 넘긴다(#439)', () => {
    const rating = { verdict: 'needsReview' as const, prohibited: false, episodes: [
      { episode: 3, verdict: 'needsReview' as const, prohibited: false, error: null, assessments: [
        { criterion: 'violence', level: 2, quotes: ['칼을 휘둘렀다'], rationale: '짧은 부상 묘사' }] }] }
    const text = stepText({ feature: 'rating', status: 'completed', rating })
    expect(text).toMatch(/^판정 제안: 작가 검토 필요\nAI가 등급을 정하지 않았어요\. 아래 근거를 보고 작가님이 직접 판단해 주세요\./)
    expect(text).toContain('3화: 작가 검토 필요\n폭력성 수준 2 · 짧은 부상 묘사 · "칼을 휘둘렀다"')
  })

  it('두 검수를 함께 돌린 결과는 두 검수 이름을 제목에 붙인다(#369)', () => {
    expect(stepText({ ...step([]), review: { ...step([]).review, check: 'both' } })).toBe('3화 초안 설정·개연성 + 맞춤법·표기 검수: 찾은 문제가 없어요.')
  })
})

describe('설정집 검토 결과 글(#479)', () => {
  const step = (findings: { kind: 'contradiction' | 'doc_role' | 'missing_info' | 'other'; message: string }[]) =>
    ({ feature: 'world_review', status: 'completed' as const, worldReview: { findings } })

  it('지적이 없으면 웹 조사 문구가 아니라 검토 결과로 알린다', () => {
    expect(stepText(step([]))).toBe('검토에서 찾은 문제가 없어요.')
  })

  it('지적마다 종류와 메시지를 보이고, 단계 이름은 설정집 검토다', () => {
    const reply: ChatReply = { status: 'completed', missingInputs: [], steps: [step([
      { kind: 'contradiction', message: '두 카드의 나이가 어긋나요.' }, { kind: 'missing_info', message: '길드 위치가 없어요.' }])] }
    expect(replyText(reply)).toBe('[설정집 검토] 설정 충돌 · 두 카드의 나이가 어긋나요.\n빠진 정보 · 길드 위치가 없어요.')
  })
})
