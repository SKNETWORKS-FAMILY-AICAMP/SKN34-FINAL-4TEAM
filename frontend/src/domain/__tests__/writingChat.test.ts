import { describe, expect, it, vi } from 'vitest'
import type { WritingEpisode } from '../entities/content'
import type { CharacterSimulation } from '../entities/characterSimulation'
import { cancelNotice, chatBasis, chatPage, cleanScene, draftNotice, featureLabel, lastScene, pendingChanges, worldProposalIsStale, PLAN_PICK_HINT, replyOutcome, replyText, stepText, type ChatPlanRevision, type ChatReply, type PendingAction, type ChatStep, type ChatWorld, type ReviewFinding, type SceneAction, type WorldFix, streamedAnswer, type ChatEvent, type ChatStatus } from '../entities/writingChat'
import type { WritingChatRepository } from '../repositories/WritingChatRepository'
import { WritingChatUseCase } from '../usecases/WritingChatUseCase'

const episode = (number: number, publishedVersionId: string | null) => ({ number, publishedVersionId }) as WritingEpisode

// 근거 회차(지식 상한, 발행된 판본 필요)와 반영 회차(targetEpisode, 작가가 연 회차: 초안이어도 된다)를 분리한다.
// 서버는 targetEpisode ≥ episode(근거)만 받으므로 근거는 열린 회차보다 뒤가 되지 않게 고른다.
// 끝난 장면 다시 보기(#420): 마지막 턴이 시뮬레이션이 아니어도 대화에 남은 가장 최근 장면을 무대가 읽기 전용으로 보인다.
describe('lastScene', () => {
  const sim = { mode: 'if', premise: '만약', beats: [], turns: [], notes: [], status: 'completed', stopReason: null } as unknown as CharacterSimulation
  const sceneStep = (extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'character_simulation', status: 'completed', simulation: sim, ...extra })
  const turn = (steps: ChatStep[]) => ({ request: '요청', reply: { status: 'completed' as const, steps, missingInputs: [] } })

  it('마지막 턴이 시뮬레이션이 아니어도 대화에 남은 가장 최근 장면 단계를 돌려준다', () => {
    const older = sceneStep({ applied: { episode: 3, revision: 1 } })
    const newer = sceneStep({ approval: 'declined' })
    expect(lastScene([turn([older]), turn([newer]), turn([{ feature: 'story_context', status: 'completed' }])])).toBe(newer)
    expect(lastScene([turn([older]), turn([])])).toBe(older)
  })

  it('장면을 읽지 못한(simulation 없는) 단계와 응답이 없는 턴은 건너뛰고, 장면이 없으면 null이다', () => {
    const readable = sceneStep()
    expect(lastScene([turn([readable]), turn([sceneStep({ simulation: null, status: 'failed' })]), { request: '요청', reply: null }])).toBe(readable)
    expect(lastScene([turn([sceneStep({ simulation: null, status: 'failed' })])])).toBeNull()
    expect(lastScene([])).toBeNull()
  })
})

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
    expect(text).toBe('[기획·집필·수정] 초안\n→ 2화 초안에 반영했어요.\n\n[고증 조사] 실패: 검색 실패')
  })

  it('종합 답변은 단계 글에 다시 넣지 않고(#492), 답변도 단계도 없을 때만 안내 문구를 쓴다', () => {
    const steps = [{ feature: 'manuscript_review', status: 'failed' as const, error: '검수 실패' }]
    expect(replyText(reply({ message: '**검수**를 마치지 못했어요.', steps }))).toBe('[원고 검수] 실패: 검수 실패')
    expect(replyText(reply({ message: '확인 질문이에요.' }))).toBe('')
    expect(replyText(reply({}))).toBe('응답 내용이 없어요.')
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

  it('기획 결과의 알림(gaps)은 확인 못 함 줄로 참고 뒤에 붙는다(#523)', () => {
    const step = { feature: 'writing_editing', status: 'completed' as const, result: {
      plans: [{ title: '항구의 밤', beats: ['선장이 도착한다.'] }], notes: ['참고 하나'], gaps: ['이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.'] } }
    expect(stepText(step)).toBe('계획 1. 항구의 밤\n  1) 선장이 도착한다.\n참고: 참고 하나\n확인 못 함: 이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.\n' + PLAN_PICK_HINT)
  })

  it('집필 결과의 알림(gaps)은 반영 본문에 섞지 않고 따로 한 줄로 보인다(#523)', () => {
    const step = { feature: 'writing_editing', status: 'completed' as const, result: {
      text: '선장은 항구에 내렸다.', gaps: ['이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.'] } }
    expect(stepText(step)).toBe('선장은 항구에 내렸다.')
    expect(draftNotice(step)).toBe('확인 못 함: 이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.')
    expect(replyText(reply({ steps: [step] }))).toBe('[기획·집필·수정] 선장은 항구에 내렸다.\n확인 못 함: 이 작품에 연결된 세계관이 없어 설정 없이 작성했어요.')
    expect(draftNotice({ ...step, result: { text: '본문', gaps: [] } })).toBe('')
  })
})

describe('replyOutcome', () => {
  const reply = (steps: ChatReply['steps']): ChatReply => ({ status: 'completed', steps, missingInputs: [], message: '종합 답변' })

  it('실패 단계와 반영·거절 결과만 줄로 돌려주고 replyText와 같은 문구를 쓴다', () => {
    const steps: ChatReply['steps'] = [
      { feature: 'writing_editing', status: 'completed', result: { text: '초안' }, applied: { episode: 2, revision: 5 } },
      { feature: 'character_simulation', status: 'completed', approval: 'declined' },
      { feature: 'web_research', status: 'failed', error: '검색 실패' },
    ]
    const lines = replyOutcome(reply(steps))
    expect(lines).toEqual(['→ 2화 초안에 반영했어요.', '→ 반영하지 않았어요.', '[고증 조사] 실패: 검색 실패'])
    for (const line of lines) expect(replyText(reply(steps))).toContain(line)
  })

  it('Content 반영이 실패해 바뀐 단계는 실패 사유를 보인다', () => {
    expect(replyOutcome(reply([{ feature: 'writing_editing', status: 'failed', error: '초안에서 고칠 문장을 찾을 수 없어요' }])))
      .toEqual(['[기획·집필·수정] 실패: 초안에서 고칠 문장을 찾을 수 없어요'])
  })

  it('보일 결과가 없으면 비어 있다(완료만 한 단계·실행 전 단계)', () => {
    expect(replyOutcome(reply([
      { feature: 'story_context', status: 'completed', result: { claims: [{ text: '밤에 닫는다' }] } },
      { feature: 'web_research', status: 'not_started' },
    ]))).toEqual([])
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
  const basis = { episode: 1, episodeVersionId: 'v' }
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
    await expect(chat.send('w', 't', { episode: 1, episodeVersionId: 'v', request: ' ' }, () => {})).rejects.toThrow('보낼 내용')
    expect(repo.rename).not.toHaveBeenCalled()
    expect(repo.send).not.toHaveBeenCalled()
    await chat.rename('w', 't', ' 새 제목 ')
    expect(repo.rename).toHaveBeenCalledWith('w', 't', '새 제목')
  })

  it('장면 조작은 다듬어 보내고, 한도를 넘기거나 잘못된 조작은 서버에 보내지 않는다', async () => {
    const repo = repository()
    repo.send.mockResolvedValue(undefined)
    const chat = new WritingChatUseCase(repo)
    const basis = { episode: 1, episodeVersionId: 'v' }
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


it('고증 조사 단계 이름은 research이고, 옛 대화 기록의 web_research 단계도 같은 이름으로 보인다(#545)', () => {
  expect(featureLabel.research).toBe('고증 조사')
  expect(featureLabel.web_research).toBe('고증 조사')
  const reply: ChatReply = { status: 'failed', missingInputs: [], steps: [{ feature: 'research', status: 'failed', error: '검색 실패' }] }
  expect(replyText(reply)).toBe('[고증 조사] 실패: 검색 실패')
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
  const step = (findings: ReviewFinding[], gaps: string[] = []) => ({ feature: 'manuscript_review', status: 'completed' as const,
    manuscriptReview: { check: 'mechanical' as const, episode: 3, revision: 4, findings, gaps } })

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
    expect(stepText({ ...step([]), manuscriptReview: { ...step([]).manuscriptReview, check: 'both' } })).toBe('3화 초안 설정·개연성 + 맞춤법·표기 검수: 찾은 문제가 없어요.')
  })
})

describe('설정집 검토 결과 글(#479)', () => {
  const step = (findings: { kind: 'contradiction' | 'doc_role' | 'missing_info' | 'other'; message: string }[]) =>
    ({ feature: 'world_review', status: 'completed' as const, worldReview: { reviewedCards: 2, findings } })

  it('지적이 없으면 웹 조사 문구가 아니라 검토 결과로 알린다', () => {
    expect(stepText(step([]))).toBe('검토에서 찾은 문제가 없어요.')
  })

  it('검토한 카드가 0장이면 문제가 없다고 하지 않고 카드가 없다고 알린다(#493)', () => {
    expect(stepText({ ...step([]), worldReview: { reviewedCards: 0, findings: [] } })).toBe('검토할 설정 카드가 없어요.')
  })

  it('지적마다 종류와 메시지를 보이고, 단계 이름은 설정집 검토다', () => {
    const reply: ChatReply = { status: 'completed', missingInputs: [], steps: [step([
      { kind: 'contradiction', message: '두 카드의 나이가 어긋나요.' }, { kind: 'missing_info', message: '길드 위치가 없어요.' }])] }
    expect(replyText(reply)).toBe('[설정집 검토] 설정 충돌 · 두 카드의 나이가 어긋나요.\n빠진 정보 · 길드 위치가 없어요.')
  })
})

describe('World 단계 결과 글(#546)', () => {
  const world = (result: ChatWorld, extra: Partial<ChatStep> = {}): ChatStep => ({ feature: 'world', task: result.task, status: 'completed', world: result, ...extra })
  const check = (findings: { kind: 'contradiction' | 'doc_role' | 'missing_info' | 'other'; message: string }[], reviewedCards = 2): ChatWorld => ({ task: 'check', reviewedCards, findings })
  const fix = (extra: Partial<WorldFix> = {}): WorldFix => ({ cardId: 'c1', cardTitle: '카엘', target: 'soul', episode: null, text: '말수가 적다.', ...extra })
  const enrich = (fixes: WorldFix[], note = ''): ChatWorld => ({ task: 'enrich', fixes, note })

  it('단계 이름은 세계관이고, 옛 대화 기록의 설정집 검토 이름도 그대로 남는다', () => {
    expect(featureLabel.world).toBe('세계관')
    expect(featureLabel.world_review).toBe('설정집 검토')
  })

  it('check는 설정집 검토와 같은 글이다(지적 없음·카드 없음 포함)', () => {
    const findings = [{ kind: 'contradiction' as const, message: '두 카드의 나이가 어긋나요.' }, { kind: 'missing_info' as const, message: '길드 위치가 없어요.' }]
    expect(stepText(world(check(findings)))).toBe('설정 충돌 · 두 카드의 나이가 어긋나요.\n빠진 정보 · 길드 위치가 없어요.')
    expect(stepText(world(check([])))).toBe('검토에서 찾은 문제가 없어요.')
    expect(stepText(world(check([], 0)))).toBe('검토할 설정 카드가 없어요.')
  })

  it('enrich는 카드 제목 · 칸 이름 아래에 바꿀 새 글을 그대로 보이고 끝에 note를 참고로 붙인다(승인 전에 읽는 글이다)', () => {
    const text = stepText(world(enrich([
      fix({ target: 'body', text: '카엘은 북문의 수문장이다.' }),
      fix({ target: 'soul', text: '말수가 적고 단호하다.' }),
      fix({ target: 'goal', text: '북문을 지킨다.' }),
      fix({ target: 'episode', episode: 3, text: '3화에서 비밀을 안다.' }),
      fix({ cardId: 'c2', cardTitle: '북문', target: 'body', text: '북쪽 성벽의 문이다.' }),
    ], '북문 규칙에 맞췄어요.')))
    expect(text).toBe([
      '카엘 · IDENTITY\n카엘은 북문의 수문장이다.',
      '카엘 · SOUL\n말수가 적고 단호하다.',
      '카엘 · GOAL\n북문을 지킨다.',
      '카엘 · 3회차 문서\n3화에서 비밀을 안다.',
      '북문 · 본문\n북쪽 성벽의 문이다.',
      '참고: 북문 규칙에 맞췄어요.',
    ].join('\n\n'))
  })

  it('enrich의 인물 본문 이름: 같은 카드에 인물 문서(SOUL·GOAL·회차) 수정안이 없으면 카드 종류를 알 수 없어 본문이라 부르고, 0회차 문서도 회차 문서다', () => {
    expect(stepText(world(enrich([fix({ target: 'body', text: '새 본문' })])))).toBe('카엘 · 본문\n새 본문')
    expect(stepText(world(enrich([fix({ target: 'episode', episode: 0, text: '시작 전 비밀' })])))).toBe('카엘 · 0회차 문서\n시작 전 비밀')
  })

  it('impact는 확정·추정 표시와 이유로 영향을 받는 곳을 보이고 충돌·확인 못 함을 잇는다', () => {
    const text = stepText(world({ task: 'impact', affected: [
      { title: '카엘', reason: '나이 설정이 어긋나요.', certainty: 'confirmed' },
      { title: '3화', reason: '3화에서 이 사건을 언급해요.', certainty: 'inferred' },
    ], conflicts: ['두 카드의 나이가 달라요.'], gaps: ['관계 기록이 없어요.'] }))
    expect(text).toBe('[확정] 카엘 · 나이 설정이 어긋나요.\n[추정] 3화 · 3화에서 이 사건을 언급해요.\n충돌: 두 카드의 나이가 달라요.\n확인 못 함: 관계 기록이 없어요.')
  })

  it('impact에 아무것도 없으면 영향 받는 곳을 찾지 못했다고 알린다', () => {
    expect(stepText(world({ task: 'impact', affected: [], conflicts: [], gaps: [] }))).toBe('영향을 받는 곳을 찾지 못했어요.')
  })

  it('반영에 실패한 world 단계는 결과가 남아 있어도 제안 대신 실패 사유를 보인다', () => {
    const failed = world(enrich([fix()]), { status: 'failed', error: '읽은 초안이 제안 때와 달라요.' })
    expect(stepText(failed)).toBe('실패: 읽은 초안이 제안 때와 달라요.')
  })

  it('반영 결과 줄은 world 단계에서 회차가 아니라 설정집 초안이라고 알리고, 반영하지 않기는 그대로다', () => {
    const body = enrich([fix()])
    const applied = world(body, { approval: 'approved', applied: { episode: 0, revision: 9 } })
    const reply: ChatReply = { status: 'completed', missingInputs: [], steps: [applied] }
    expect(replyOutcome(reply)).toEqual(['→ 설정집 초안에 반영했어요.'])
    expect(replyText(reply)).toBe('[세계관] ' + stepText(applied) + '\n→ 설정집 초안에 반영했어요.')
    expect(replyOutcome({ ...reply, steps: [world(body, { approval: 'declined' })] })).toEqual(['→ 반영하지 않았어요.'])
  })
})

// 화면 맥락(#554): 메시지마다 작가가 보는 화면을 싣는다. 길이 상한은 서버(Content DTO·AI PageContext)와 같다.
describe('chatPage', () => {
  const studio = { path: '/studio/w?ep=3', kind: 'studio' as const, episode: 3 }

  it('경로·종류·대상 id만 있으면 그대로 싣고 비어 있는 값은 키를 넣지 않는다', () => {
    expect(chatPage(studio)).toEqual(studio)
    expect(chatPage({ path: '/worldstudio/w?card=k', kind: 'world', worldId: 'w', cardId: 'k', view: undefined })).toEqual({ path: '/worldstudio/w?card=k', kind: 'world', worldId: 'w', cardId: 'k' })
  })

  it('경로는 300자까지만 싣는다(표시용이라 잘라도 된다)', () => {
    expect(chatPage({ ...studio, path: `/studio/${'a'.repeat(400)}` }).path).toHaveLength(300)
  })

  it('선택한 글은 5,000자까지 싣고 넘으면 전송에 필요한 수정 방법을 알린다', () => {
    expect(chatPage({ ...studio, selection: '그는 웃었다.' }).selection).toBe('그는 웃었다.')
    expect(chatPage({ ...studio, selection: '가'.repeat(5000) }).selection).toHaveLength(5000)
    for (const selection of ['', '  \n ']) expect(chatPage({ ...studio, selection })).not.toHaveProperty('selection')
    expect(() => chatPage({ ...studio, selection: '가'.repeat(5001) })).toThrow('5,000자')
  })

  it('저장하지 않은 편집 내용은 unsaved로 싣고 없으면 content를 넣지 않는다', () => {
    expect(chatPage({ ...studio, unsaved: { title: '3화', body: '고친 본문' } }).content).toEqual({ title: '3화', body: '고친 본문', unsaved: true })
    expect(chatPage(studio)).not.toHaveProperty('content')
  })

  it('본문은 10,000자까지 보내고 넘으면 잘라 truncated를 붙인다(이름은 300자까지)', () => {
    expect(chatPage({ ...studio, unsaved: { body: '가'.repeat(10000) } }).content).toEqual({ body: '가'.repeat(10000), unsaved: true })
    const cut = chatPage({ ...studio, unsaved: { title: '제'.repeat(301), body: '나'.repeat(10001) } }).content!
    expect(cut.body).toHaveLength(10000)
    expect(cut.title).toHaveLength(300)
    expect(cut.truncated).toBe(true)
  })

  it('자르는 자리가 서로게이트 쌍의 가운데이면 한 글자 앞에서 자른다', () => {
    const body = `${'가'.repeat(9999)}😀뒤`
    expect(chatPage({ ...studio, unsaved: { body } }).content!.body).toBe('가'.repeat(9999))
  })
})

describe('worldProposalIsStale', () => {
  it('같은 세계관의 저장 revision이 바뀌었을 때만 이전 제안을 잠근다', () => {
    const action: PendingAction = { tool: 'world_studio_edit_draft', label: '', args: { id: 'w', request: { expectedDraftRevision: 4 } } }
    expect(worldProposalIsStale(action, { id: 'w', revision: 5 })).toBe(true)
    expect(worldProposalIsStale(action, { id: 'w', revision: 4 })).toBe(false)
    expect(worldProposalIsStale(action, { id: 'other', revision: 5 })).toBe(false)
    expect(worldProposalIsStale({ ...action, tool: 'work_update' }, { id: 'w', revision: 5 })).toBe(false)
    expect(worldProposalIsStale({ ...action, args: { id: 'w', expectedDraftRevision: 4 } }, { id: 'w', revision: 5 })).toBe(true)
  })
})

describe('pendingChanges', () => {
  const card = { id: 'k', title: '카엘', body: '북문을 지키는 기사' }
  const edit = (cards: object[]): PendingAction => ({ tool: 'world_studio_edit_draft', label: '세계관 설정 카드 수정', args: { id: 'w', request: { cards } } })

  it('카드 수정은 그 카드의 수정 전과 후를 칸마다 알려 준다', () => {
    expect(pendingChanges(edit([{ id: 'k', body: '과묵한 기사' }]), (id) => (id === 'k' ? card : undefined)))
      .toEqual([{ name: '카엘 · 설명', before: '북문을 지키는 기사', after: '과묵한 기사' }])
    expect(pendingChanges(edit([{ id: 'k', title: '카엘 경', body: '북문을 지키는 기사' }]), () => card))
      .toEqual([{ name: '카엘 · 이름', before: '카엘', after: '카엘 경' }])
  })

  it('저장된 카드에 없는 카드는 새 설정으로 보고 수정 전이 없다', () => {
    expect(pendingChanges(edit([{ id: 'n', title: '새 설정', body: '본문' }]), () => undefined))
      .toEqual([{ name: '새 설정 · 이름', before: null, after: '새 설정' }, { name: '새 설정 · 설명', before: null, after: '본문' }])
  })

  it('카드 수정이 아닌 도구나 모양이 어긋난 인자는 칸을 만들지 않는다(화면이 도구 인자를 그대로 보인다)', () => {
    expect(pendingChanges({ tool: 'work_update', label: '작품 정보 수정', args: { id: 'w' } })).toEqual([])
    expect(pendingChanges({ tool: 'world_studio_edit_draft', label: '', args: { id: 'w', request: 3 } })).toEqual([])
  })
})

describe('content_action 단계(#554)', () => {
  const step: ChatStep = { feature: 'content_action', status: 'completed', result: { tool: 'work_update', label: '작품 정보 수정' }, approval: 'approved', applied: { episode: 3, revision: 9 } }

  it('승인 뒤 실행한 Content 작업은 고정 문구로 보이고 반영 줄은 회차 초안이 아니라 승인한 작업이라고 알린다', () => {
    expect(stepText(step)).toBe('작품 정보 수정 완료')
    expect(replyOutcome({ status: 'completed', steps: [step], missingInputs: [] })).toEqual(['→ 승인한 작업을 실행했어요.'])
  })

  it('실패한 Content 작업은 사유를 그대로 보인다', () => {
    expect(stepText({ feature: 'content_action', status: 'failed', error: '세계관 초안이 바뀌었어요.' })).toBe('실패: 세계관 초안이 바뀌었어요.')
  })
})

describe('pendingChanges (평평한 인자)', () => {
  it('모델이 request로 감싸지 않고 cards를 바로 보낸 카드 수정도 수정 전·후를 알려 준다', () => {
    const action: PendingAction = { tool: 'world_studio_edit_draft', label: '세계관 설정 카드 수정', args: { id: 'w', expectedDraftRevision: 3, cards: [{ id: 'k', title: '카엘 공' }] } }
    expect(pendingChanges(action, () => ({ title: '카엘 경', body: '기사' }))).toEqual([{ name: '카엘 경 · 이름', before: '카엘 경', after: '카엘 공' }])
  })
})

describe('계획 수정안 결과 글(#578)', () => {
  const planRevision = (extra: Partial<ChatPlanRevision['after']> = {}, extraStep: Partial<ChatStep> = {}): ChatStep => ({
    feature: 'writing_editing', task: 'revise_plan', status: 'completed',
    planRevision: { kind: 'scene', before: { title: '재회', content: '카엘이 리나를 만난다.' }, after: { title: '재회', content: '카엘이 리나를 만나지만 이름을 부르지 못한다.', ...extra } },
    ...extraStep,
  })

  it('대상(종류·제목)과 변경 전·후 내용을 승인 전에 보인다', () => {
    expect(stepText(planRevision())).toBe("장면 계획 '재회' 수정안\n수정 전: 카엘이 리나를 만난다.\n수정 후: 카엘이 리나를 만나지만 이름을 부르지 못한다.")
    expect(stepText({ ...planRevision(), planRevision: { kind: 'plot', before: { title: '복수극', content: 'a' }, after: { title: '복수극', content: 'b' } } })).toMatch(/^플롯 '복수극' 수정안/)
  })

  it('제목이 바뀌면 전·후 제목을 따로 보이고, 그대로면 제목 줄을 두지 않는다', () => {
    expect(stepText(planRevision({ title: '재회 직전' }))).toContain("\n제목: 재회 → 재회 직전\n")
    expect(stepText(planRevision())).not.toContain('제목:')
  })

  it('저장한 계획 수정은 회차 초안이 아니라 계획에 저장했다고, 거절하면 저장하지 않았다고 알린다', () => {
    const saved = planRevision({}, { approval: 'approved', applied: { episode: 3, revision: 6 } })
    expect(replyOutcome({ status: 'completed', missingInputs: [], steps: [saved] })).toEqual(['→ 계획에 저장했어요.'])
    expect(replyOutcome({ status: 'completed', missingInputs: [], steps: [planRevision({}, { approval: 'declined' })] })).toEqual(['→ 저장하지 않았어요.'])
  })

  it('저장에 실패(409 등)하면 제안 대신 Content가 준 사유를 보이고 저장했다는 줄은 없다', () => {
    const failed = planRevision({}, { status: 'failed', approval: 'approved', error: '제안한 뒤 계획이 바뀌어 저장하지 않았어요. 다시 요청해 주세요.' })
    expect(stepText(failed)).toBe('실패: 제안한 뒤 계획이 바뀌어 저장하지 않았어요. 다시 요청해 주세요.')
    expect(replyOutcome({ status: 'failed', missingInputs: [], steps: [failed] })).toEqual(['[기획·집필·수정] 실패: 제안한 뒤 계획이 바뀌어 저장하지 않았어요. 다시 요청해 주세요.'])
  })
})

describe('흐르는 답변 본문(#618)', () => {
  const after = (...events: ChatEvent[]) => events.reduce(streamedAnswer, '')
  const delta = (text: string | null): ChatEvent => ({ type: 'answer', delta: text })
  const done = (status: ChatStatus): ChatEvent => ({ type: 'done', reply: { status, steps: [], missingInputs: [] } })

  it('조각을 순서대로 잇고 단계 이벤트에는 그대로 둔다', () => {
    expect(after(delta('길드는 '), { type: 'started', feature: 'rating' }, delta('밤에 닫아요.'))).toBe('길드는 밤에 닫아요.')
  })
  it('초기화(null) 뒤에는 새 글만 남는다', () => {
    expect(after(delta('확인해 볼게요.'), delta(null), delta('닫아요.'))).toBe('닫아요.')
  })
  it('실패하면 쓰다 만 글을 버린다', () => {
    expect(after(delta('쓰다 만'), { type: 'error', message: '끊김' })).toBe('')
    expect(after(delta('쓰다 만'), done('failed'))).toBe('')
  })
  it('정상 종료는 저장된 답으로 바뀔 때까지 글을 남긴다', () => {
    expect(after(delta('닫아요.'), done('completed'))).toBe('닫아요.')
  })
})

// 입력 대기의 취소 안내(#661): 이미 끝난 작업까지 없던 일이 되는 것처럼 말하지 않는다.
describe('cancelNotice', () => {
  const waiting = (...steps: ChatStep[]): ChatReply => ({ status: 'waiting', steps, missingInputs: ['research'] })
  it('끝난 작업이 없으면(대기·실패·건너뜀뿐이면) 아무 작업도 실행하지 않는다고 알린다', () => {
    const none = '취소하면 아무 작업도 실행하지 않아요.'
    expect(cancelNotice(waiting())).toBe(none)
    expect(cancelNotice(waiting({ feature: 'research', status: 'not_started' }, { feature: 'rating', status: 'failed' }, { feature: 'writing_editing', status: 'skipped' }))).toBe(none)
  })
  it('끝난 작업이 있으면 남은 작업만 멈추고 끝난 작업은 그대로라고 알린다', () => {
    expect(cancelNotice(waiting({ feature: 'content_action', status: 'completed' }, { feature: 'research', status: 'not_started' })))
      .toBe('취소하면 남은 작업은 실행하지 않아요. 이미 끝난 작업은 그대로예요.')
  })
})
