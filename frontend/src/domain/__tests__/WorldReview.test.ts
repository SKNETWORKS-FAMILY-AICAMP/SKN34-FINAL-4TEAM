import { describe, expect, it } from 'vitest'

import { characterDocText } from '../entities/characterDocs'
import { newSetting, type CharacterDocs, type SettingItem, type StudioSetting } from '../entities/studioWorld'
import {
  applyReviewFix, cardFindings, cardStatuses, publicationOrderIssues, REVIEW_FIX_BLOCKED, reviewClock, reviewFixName, reviewFixState, reviewPartialNote, reviewSummary, unlinkedCardIds, visibleFindings,
  type ReviewBasis, type ReviewFinding, type ReviewFix, type WorldReview,
} from '../entities/worldReview'

const card = (section: Parameters<typeof newSetting>[0], title: string, patch: Partial<SettingItem> = {}, extra: Partial<StudioSetting> = {}): StudioSetting => {
  const row = newSetting(section)
  row.item = { ...row.item, title, text: `${title} 본문`, ...patch }
  return { ...row, ...extra }
}
const person = (title: string, docs?: Partial<CharacterDocs>) => card('people', title, {}, docs ? { characterDocs: { soul: '', goal: '', episodes: {}, ...docs } } : {})
const place = (title: string) => card('places', title)
const rule = (title: string) => card('special', title, { kind: 'rule' })
const event = (title: string) => card('history', title, { kind: 'event' })
const thing = (title: string) => card('basic', title, { kind: 'entity', entityType: 'object' })
/** 초안의 관계 행. 기본은 승인된 긍정 관계다. */
const link = (a: StudioSetting, b: StudioSetting, over: Partial<SettingItem> = {}): StudioSetting => {
  const row = newSetting()
  row.item = { ...row.item, kind: 'relation', subjectId: a.item.id, targetId: b.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', decision: 'approved', ...over }
  return row
}
const ids = (settings: StudioSetting[]) => settings.map((s) => s.item.id)

describe('연결 필요: 사건·사물 카드가 어느 인물과도 승인된 관계로 이어지지 않음', () => {
  it('사건·사물만 대상이고 인물·장소·규칙은 관계가 없어도 연결 필요가 아니다', () => {
    const [a, b, c, war, sword] = [person('가람'), place('성'), rule('금기'), event('전쟁'), thing('검')]
    expect(unlinkedCardIds([a, b, c, war, sword])).toEqual(new Set(ids([war, sword])))
    expect(unlinkedCardIds([])).toEqual(new Set())
  })

  it('인물과 승인된 긍정 관계로 이어지면 어느 방향이든 이어진 것이다', () => {
    const [a, war, sword, other] = [person('가람'), event('전쟁'), thing('검'), thing('방패')]
    const settings = [a, war, sword, other, link(a, war), link(sword, a)]
    expect(unlinkedCardIds(settings)).toEqual(new Set(ids([other])))
  })

  it.each([
    ['부정(denied) 관계', { polarity: 'denied' as const }],
    ['거절한 관계', { decision: 'rejected' as const }],
    ['보류한 관계', { decision: 'held' as const }],
    ['아직 검토하지 않은 관계', { decision: 'pending' as const }],
  ])('%s는 이어진 것으로 치지 않는다', (_, over) => {
    const [a, war] = [person('가람'), event('전쟁')]
    expect(unlinkedCardIds([a, war, link(a, war, over)])).toEqual(new Set(ids([war])))
  })

  it('인물이 아닌 카드와의 관계·초안에 없는(삭제한) 인물과의 관계·관계 행끼리의 이음은 이어진 것이 아니다', () => {
    const [a, castle, war, sword] = [person('가람'), place('성'), event('전쟁'), thing('검')]
    const gone = person('사라진 인물')
    const settings = [a, castle, war, sword, link(castle, war), link(gone, sword)]
    expect(unlinkedCardIds(settings)).toEqual(new Set(ids([war, sword])))
  })
})

const finding = (cardIds: string[], over: Partial<ReviewFinding> = {}): ReviewFinding => ({ cardIds, kind: 'contradiction', message: '두 설정이 어긋나요.', ...over })

describe('게시판 상태 집계', () => {
  it('정리 필요·연결 필요·AI 의견 수를 카드마다 세고 상태가 없는 카드는 담지 않는다', () => {
    const empty = person('빈 인물') // IDENTITY는 있으나 SOUL이 비어 정리 필요
    const full = person('가람', { soul: '말수가 적다', goal: '스승을 찾는다' })
    const war = event('전쟁')
    const castle = place('성')
    const settings = [empty, full, war, castle, link(full, war)]
    const status = cardStatuses(settings, [finding([castle.item.id]), finding([castle.item.id, full.item.id])])
    expect(status.get(empty.item.id)).toEqual({ cleanup: true, unlinked: false, opinions: 0, order: false })
    expect(status.get(castle.item.id)).toEqual({ cleanup: false, unlinked: false, opinions: 2, order: false })
    expect(status.get(full.item.id)).toEqual({ cleanup: false, unlinked: false, opinions: 1, order: false })
    expect(status.has(war.item.id)).toBe(false)
    expect(cardStatuses([...settings, event('고립된 사건')], []).size).toBe(2)
  })

  it('GOAL.md만 비운 인물은 정리 필요가 아니다(목표는 선택, #624)', () => {
    const goalless = person('도윤', { soul: '말수가 적다' })
    expect(cardStatuses([goalless], []).size).toBe(0)
  })

  it('같은 카드를 한 지적에 두 번 적어도 한 건이고, 초안에 없는 카드의 지적은 세지 않는다', () => {
    const castle = place('성')
    const status = cardStatuses([castle], [finding([castle.item.id, castle.item.id]), finding([crypto.randomUUID()])])
    expect(status.get(castle.item.id)?.opinions).toBe(1)
    expect(status.size).toBe(1)
  })

  it('cardFindings는 그 카드를 가리킨 지적을 검토가 준 순서와 번호 그대로 돌려준다', () => {
    const [a, b] = [person('가람'), place('성')]
    const list = [finding([b.item.id]), finding([a.item.id, b.item.id], { kind: 'doc_role' }), finding([a.item.id])]
    expect(cardFindings(list, b.item.id).map((f) => f.id)).toEqual([0, 1])
    expect(cardFindings(list, a.item.id).map((f) => f.finding.kind)).toEqual(['doc_role', 'contradiction'])
    expect(cardFindings(list, crypto.randomUUID())).toEqual([])
  })
})

describe('지금 초안에 없는 카드의 지적은 보이지 않는다', () => {
  it('가리킨 카드가 하나라도 초안에 남아 있으면 보이고, 모두 없으면(삭제·다른 세계관) 숨긴다', () => {
    const [a, b, castle] = [person('가람'), person('나래'), place('성')]
    const gone = crypto.randomUUID()
    const list = [finding([a.item.id]), finding([gone]), finding([gone, b.item.id]), finding([gone, crypto.randomUUID()]), finding([castle.item.id], { kind: 'doc_role' })]
    expect(visibleFindings(list, [a, b, castle])).toEqual([list[0], list[2], list[4]])
    expect(visibleFindings(list, [b])).toEqual([list[2]]) // 가람·성을 지우면 그 지적도 사라진다
    expect(visibleFindings(list, [])).toEqual([])
    expect(visibleFindings([], [a])).toEqual([])
  })

  it('관계 행은 카드가 아니라서 관계 id를 가리킨 지적은 보이지 않고, 입력 목록은 바꾸지 않는다', () => {
    const [a, castle] = [person('가람'), place('성')]
    const relation = link(a, castle)
    const list = [finding([relation.item.id]), finding([a.item.id, relation.item.id])]
    expect(visibleFindings(list, [a, castle, relation])).toEqual([list[1]])
    expect(list).toHaveLength(2)
  })
})

const fixOf = (cardId: string, target: ReviewFix['target'], text = '바꾼 글', episode?: number): ReviewFix =>
  (target === 'episode' ? { cardId, target, text, episode: episode ?? 0 } : { cardId, target, text })

/**
 * 서버가 검토 응답에 싣는 기준(basis): 수정안이 가리킨 카드마다 검토한 초안의 그 카드 글(본문 링크를 벗기기 전 원문). 테스트는 검토 때의 초안(저장본)에서 만든다.
 * 잠금 기준이 '요청 때 화면이 가진 저장본'이 아니라 이 기준이라, 새로 고친 뒤(화면에 저장본이 없을 때)에도 POST 직후와 같다.
 */
const basisFrom = (...rows: StudioSetting[]): ReviewBasis =>
  Object.fromEntries(rows.map((row) => [row.item.id, { body: row.item.text, ...(row.characterDocs && { characterDocs: row.characterDocs }) }]))

describe('수정안 반영: 대상 칸을 찾고, 검토 뒤 바뀌었으면 잠그고, 초안의 그 칸만 바꾼다', () => {
  it('body는 카드 본문(인물이면 IDENTITY.md)만 바꾸고 다른 카드·칸은 그대로 둔다', () => {
    const a = person('가람', { soul: '말수가 적다' })
    const b = place('성')
    const before = [a, b]
    const after = applyReviewFix(before, fixOf(a.item.id, 'body', '새 본문'), basisFrom(a, b))
    expect(after[0].item.text).toBe('새 본문')
    expect(after[0].characterDocs).toEqual(a.characterDocs)
    expect(after[1]).toBe(b)
    expect(a.item.text).toBe('가람 본문') // 입력은 건드리지 않는다
    expect(applyReviewFix([b], fixOf(b.item.id, 'body', '성 새 본문'), basisFrom(b))[0].item.text).toBe('성 새 본문')
  })

  it.each(['soul', 'goal'] as const)('%s는 인물 문서 그 칸만 바꾼다', (target) => {
    const a = person('가람', { soul: '말수가 적다', goal: '스승을 찾는다', episodes: { 1: '스승을 잃었다' } })
    const [after] = applyReviewFix([a], fixOf(a.item.id, target, '새 글'), basisFrom(a))
    expect(after.characterDocs).toEqual({ ...a.characterDocs, [target]: '새 글' })
    expect(after.item.text).toBe(a.item.text)
  })

  it('episode는 그 회차 기억만 바꾸고 아직 없는 회차는 새로 만든다', () => {
    const a = person('가람', { episodes: { 1: '스승을 잃었다' } })
    const [edited] = applyReviewFix([a], fixOf(a.item.id, 'episode', '스승의 유품을 얻었다', 1), basisFrom(a))
    expect(edited.characterDocs?.episodes).toEqual({ 1: '스승의 유품을 얻었다' })
    const [created] = applyReviewFix([a], fixOf(a.item.id, 'episode', '새 기억', 3), basisFrom(a)) // 기준에 없는 회차 기억은 빈 글이다
    expect(created.characterDocs?.episodes).toEqual({ 1: '스승을 잃었다', 3: '새 기억' })
    expect(characterDocText(created, 3)).toBe('새 기억')
    const bare = person('문서 없는 인물') // characterDocs가 아예 없는 인물도 그 칸으로 시작한다
    expect(applyReviewFix([bare], fixOf(bare.item.id, 'goal', '목표'), basisFrom(bare))[0].characterDocs).toEqual({ soul: '', goal: '목표', episodes: {} })
  })

  it('검토 때와 지금의 그 칸 글이 같으면 ready, 다르면 stale이며 stale은 반영하지 않고 이유를 던진다', () => {
    const a = person('가람', { soul: '말수가 적다', episodes: { 1: '스승을 잃었다' } })
    const basis = basisFrom(a)
    const edited = (change: Partial<StudioSetting>, text = a.item.text): StudioSetting[] => [{ ...a, ...change, item: { ...a.item, text } }]
    expect(reviewFixState(fixOf(a.item.id, 'body'), basis, [a])).toBe('ready')
    // 본문만 바뀌었을 때 다른 칸(SOUL)의 수정안은 여전히 반영할 수 있다
    expect(reviewFixState(fixOf(a.item.id, 'soul'), basis, edited({}, '다른 본문'))).toBe('ready')
    expect(reviewFixState(fixOf(a.item.id, 'body'), basis, edited({}, '다른 본문'))).toBe('stale')
    expect(reviewFixState(fixOf(a.item.id, 'soul'), basis, edited({ characterDocs: { ...a.characterDocs!, soul: '말수가 많다' } }))).toBe('stale')
    expect(reviewFixState(fixOf(a.item.id, 'episode', '', 1), basis, edited({ characterDocs: { ...a.characterDocs!, episodes: { 1: '고쳐 씀' } } }))).toBe('stale')
    const current = edited({}, '다른 본문')
    expect(() => applyReviewFix(current, fixOf(a.item.id, 'body'), basis)).toThrow(REVIEW_FIX_BLOCKED.stale)
    expect(REVIEW_FIX_BLOCKED.stale).toBe('검토 뒤 바뀐 설정이라 반영할 수 없어요')
  })

  it('지워진 카드·인물이 아닌 카드의 인물 문서 칸은 missing이라 반영하지 않는다', () => {
    const [a, castle] = [person('가람'), place('성')]
    expect(reviewFixState(fixOf(a.item.id, 'body'), basisFrom(a), [castle])).toBe('missing')
    for (const target of ['soul', 'goal', 'episode'] as const) {
      expect(reviewFixState(fixOf(castle.item.id, target), basisFrom(castle), [castle])).toBe('missing')
      expect(() => applyReviewFix([castle], fixOf(castle.item.id, target), basisFrom(castle))).toThrow(REVIEW_FIX_BLOCKED.missing)
    }
    // 관계 행의 id는 카드가 아니다
    const relation = link(a, castle)
    expect(reviewFixState(fixOf(relation.item.id, 'body'), basisFrom(a, castle, relation), [a, castle, relation])).toBe('missing')
  })

  it('기준(basis)에 그 카드가 없으면 검토 때의 글을 알 수 없어 지금 글을 덮어쓸 수 없다(stale)', () => {
    const a = person('가람', { soul: '말수가 적다' })
    for (const target of ['body', 'soul', 'goal', 'episode'] as const) {
      expect(reviewFixState(fixOf(a.item.id, target), {}, [a])).toBe('stale')
      expect(() => applyReviewFix([a], fixOf(a.item.id, target), basisFrom(person('다른 인물')))).toThrow(REVIEW_FIX_BLOCKED.stale)
    }
  })

  it('잠금은 화면이 가진 저장본이 아니라 서버가 준 기준의 글과 견준다: 응답 JSON 모양 그대로의 기준으로도 같은 규칙이다', () => {
    const a = person('가람', { soul: '말수가 적다', goal: '스승을 찾는다', episodes: { 0: '시작 전 비밀', 1: '스승을 잃었다' } })
    // JSON 응답에서 회차 키는 글자다(`episodes: { "1": … }`). 본문 링크도 벗기지 않은 원문 그대로다.
    const wire = JSON.parse(JSON.stringify({ [a.item.id]: { body: a.item.text, characterDocs: a.characterDocs } })) as ReviewBasis
    const same = [a]
    expect(['body', 'soul', 'goal'].map((target) => reviewFixState(fixOf(a.item.id, target as ReviewFix['target']), wire, same))).toEqual(['ready', 'ready', 'ready'])
    expect([0, 1].map((n) => reviewFixState(fixOf(a.item.id, 'episode', '', n), wire, same))).toEqual(['ready', 'ready'])
    // 검토한 뒤 서버(다른 탭·AI 반영)에서 그 칸이 바뀐 초안을 새로 읽으면 기준과 달라 잠긴다 — 요청 때의 화면 저장본이 없어도 그렇다.
    const changed = [{ ...a, item: { ...a.item, text: '서버에서 바뀐 본문' } }]
    expect(reviewFixState(fixOf(a.item.id, 'body'), wire, changed)).toBe('stale')
    expect(reviewFixState(fixOf(a.item.id, 'soul'), wire, changed)).toBe('ready')
  })

  it('기준에 없는 문서는 빈 글로 견준다: 검토 때 없던 회차 기억·인물 문서를 작가가 그 뒤에 썼으면 stale이고, 여전히 없으면 ready다', () => {
    const bare = person('문서 없는 인물') // 기준은 {body}뿐이다(characterDocs 없음)
    const basis = basisFrom(bare)
    expect(reviewFixState(fixOf(bare.item.id, 'soul'), basis, [bare])).toBe('ready')
    expect(reviewFixState(fixOf(bare.item.id, 'episode', '', 3), basis, [bare])).toBe('ready')
    const wrote = { ...bare, characterDocs: { soul: '새로 쓴 성격', goal: '', episodes: { 3: '새로 쓴 기억' } } }
    expect(reviewFixState(fixOf(bare.item.id, 'soul'), basis, [wrote])).toBe('stale')
    expect(reviewFixState(fixOf(bare.item.id, 'episode', '', 3), basis, [wrote])).toBe('stale')
    expect(reviewFixState(fixOf(bare.item.id, 'goal'), basis, [wrote])).toBe('ready') // 목표는 그대로 빈 글이다
  })

  it('수정안이 지금 글과 같으면 초안을 바꾸지 않고 같은 목록을 돌려준다', () => {
    const a = person('가람')
    const settings = [a]
    expect(applyReviewFix(settings, fixOf(a.item.id, 'body', a.item.text), basisFrom(a))).toBe(settings)
  })
})

const review = (over: Partial<WorldReview> = {}): WorldReview => ({ reviewedCards: 40, totalCards: 40, findings: [finding([crypto.randomUUID()]), finding([crypto.randomUUID()])], reviewedAt: new Date(2026, 10, 16, 9, 5), basis: {}, ...over })

describe('검토 요약 문구', () => {
  const at = new Date(2026, 10, 16, 9, 5) // 로컬 시각 09:05
  it('검토 시각은 두 자리 시:분이다', () => {
    expect(reviewClock(at)).toBe('09:05')
    expect(reviewClock(new Date(2026, 10, 16, 0, 0))).toBe('00:00')
  })

  it('수정안이 바꿀 칸의 이름은 인물 문서는 파일 이름, 인물이 아닌 카드의 본문은 설정 본문이다', () => {
    const [a, castle] = [person('가람'), place('성')]
    expect([
      reviewFixName(a, fixOf(a.item.id, 'body')), reviewFixName(a, fixOf(a.item.id, 'soul')), reviewFixName(a, fixOf(a.item.id, 'goal')),
      reviewFixName(a, fixOf(a.item.id, 'episode', '', 0)), reviewFixName(a, fixOf(a.item.id, 'episode', '', 12)), reviewFixName(castle, fixOf(castle.item.id, 'body')),
    ]).toEqual(['IDENTITY.md', 'SOUL.md', 'GOAL.md', 'memory/00회차.md', 'memory/12회차.md', '설정 본문'])
  })

  it('AI 의견 N건 · 카드 M장 · HH:mm 검토: 시각은 응답의 reviewedAt이고 N은 화면에 보이는 지적 수다', () => {
    expect(reviewSummary(review({ reviewedAt: at }), 2)).toBe('AI 의견 2건 · 카드 40장 · 09:05 검토')
    expect(reviewSummary(review({ reviewedAt: at }), 1)).toBe('AI 의견 1건 · 카드 40장 · 09:05 검토') // 지금 초안에 없는 카드의 지적은 빼고 센다
    expect(reviewSummary(review({ findings: [], reviewedCards: 0, totalCards: 0, reviewedAt: new Date(2026, 10, 16, 23, 59) }), 0)).toBe('AI 의견 0건 · 카드 0장 · 23:59 검토')
  })

  it('보낸 카드가 전체보다 적을 때만 그 사실을 알린다', () => {
    expect(reviewPartialNote(review())).toBe('')
    expect(reviewPartialNote(review({ reviewedCards: 300, totalCards: 412 }))).toBe('카드 412장 중 300장만 검토했어요. 한 번에 보낼 수 있는 분량을 넘은 카드는 검토하지 못했어요.')
  })
})

describe('공개 순서 점검: 이른 카드의 글에 늦은 카드의 이름이 나오면 알린다 (DEC-53)', () => {
  const pub = (n: number, row: StudioSetting): StudioSetting => ({ ...row, revealFromEpisode: n })
  const text = (title: string, body: string, extra: Partial<StudioSetting> = {}) => card('people', title, { text: body }, extra)
  const named = (row: StudioSetting, from?: number) => ({ cardId: row.item.id, title: row.item.title, ...(from !== undefined && { from }) })

  it('N화부터 공개하는 카드의 본문에 더 늦게 공개되는 카드의 제목이 나오면 본문 경고다', () => {
    const lian = pub(1, text('리안', '리안은 승상과 오랜 벗이다.'))
    const minister = pub(5, text('승상', '궁정의 어른'))
    expect(publicationOrderIssues([lian, minister])).toEqual([{ cardId: lian.item.id, source: 'body', name: '승상', named: named(minister, 5), visibleFrom: 1 }])
  })

  it('이름의 카드가 같거나 더 이른 회차에 공개되면 경고하지 않는다', () => {
    const lian = pub(3, text('리안', '승상과 황제를 안다.'))
    expect(publicationOrderIssues([lian, pub(3, text('승상', '')), pub(1, text('황제', ''))])).toEqual([])
  })

  it('작가 전용 카드의 제목·별칭이 공개 카드의 글에 나와도 경고한다(작가 전용은 가장 늦은 회차로 본다)', () => {
    const lian = pub(2, text('리안', '실은 흑막이다.'))
    const secret = text('흑막', '', { aliases: ['그림자', ' '] })
    expect(publicationOrderIssues([lian, secret])).toEqual([{ cardId: lian.item.id, source: 'body', name: '흑막', named: named(secret), visibleFrom: 2 }])
    const alias = pub(2, text('리안', '그림자가 드리웠다.'))
    expect(publicationOrderIssues([alias, secret]).map((i) => [i.name, i.named.from])).toEqual([['그림자', undefined]])
  })

  it('작가 전용 카드의 글은 독자에게 보이지 않으므로 점검하지 않고, 옛 공개 카드(회차 없음)는 1화로 본다', () => {
    const closed = text('리안', '승상을 안다.')
    const minister = pub(5, text('승상', ''))
    expect(publicationOrderIssues([closed, minister])).toEqual([])
    const legacy = text('리안', '승상을 안다.', { visibility: 'public' })
    expect(publicationOrderIssues([legacy, minister]).map((i) => i.visibleFrom)).toEqual([1])
  })

  it('링크 글자는 글로 보고 링크의 id는 이름으로 치지 않으며 자기 이름은 경고하지 않는다', () => {
    const minister = pub(5, text('승상', ''))
    const hex = text('aaaa', '') // 작가 전용. 링크 id의 16진수와 같은 글자
    const lian = pub(1, text('리안', `[승상](card:${minister.item.id}) 과 [갑](card:aaaaaaaa-2222-3333-4444-555555555555), 리안`))
    expect(publicationOrderIssues([lian, minister, hex]).map((i) => i.name)).toEqual(['승상'])
  })

  it('이름이 빈 카드는 건너뛰고 한 글에서 같은 카드는 한 번만 알린다(제목이 먼저)', () => {
    const lian = pub(1, text('리안', '승상 재상 승상'))
    const minister = pub(4, text('승상', '', { aliases: ['재상'] }))
    expect(publicationOrderIssues([lian, minister, text('', '')]).map((i) => i.name)).toEqual(['승상'])
  })

  it('관계의 label·body는 두 끝 카드 가운데 늦은 회차부터 보이는 글로 보고 끝점 카드마다 알린다', () => {
    const [a, b] = [pub(1, text('리안', '')), pub(3, text('카엘', ''))]
    const emperor = pub(5, text('황제', ''))
    const relation = link(a, b, { title: '동료', text: '황제와도 아는 사이' })
    const issues = publicationOrderIssues([a, b, emperor, relation])
    expect(issues).toEqual([a, b].map((end) => ({ cardId: end.item.id, source: 'relation', relationId: relation.item.id, name: '황제', named: named(emperor, 5), visibleFrom: 3 })))
    // label(title)도 본다.
    expect(publicationOrderIssues([a, b, emperor, link(a, b, { title: '황제의 사람', text: '' })]).map((i) => i.name)).toEqual(['황제', '황제'])
    // 이름의 카드가 관계가 보이는 회차 이하면 괜찮다.
    expect(publicationOrderIssues([a, b, pub(3, text('황제', '')), relation])).toEqual([])
  })

  it('끝점 하나라도 작가 전용이면 그 관계는 독자에게 보이지 않아 점검하지 않는다', () => {
    const [a, b] = [pub(1, text('리안', '')), text('카엘', '')]
    expect(publicationOrderIssues([a, b, pub(9, text('황제', '')), link(a, b, { text: '황제를 안다' })])).toEqual([])
  })

  it('관계는 두 끝 카드와 관계의 기록 회차(fromEpisode) 가운데 가장 늦은 회차부터 보이는 글이다', () => {
    const [a, b] = [pub(1, text('리안', '')), pub(3, text('카엘', ''))]
    const emperor = pub(5, text('황제', ''))
    const recorded = (n?: number) => link(a, b, { title: '보호', text: '황제를 안다', ...(n !== undefined && { fromEpisode: n }) })
    // 4화에 기록한 관계는 4화부터 보이는데 황제는 5화부터 공개라 이름이 먼저 드러난다.
    expect(publicationOrderIssues([a, b, emperor, recorded(4)]).map((i) => [i.cardId, i.visibleFrom])).toEqual([[a.item.id, 4], [b.item.id, 4]])
    // 황제가 공개되는 5화 이후에 기록한 관계는 괜찮다.
    expect(publicationOrderIssues([a, b, emperor, recorded(5)])).toEqual([])
    expect(publicationOrderIssues([a, b, emperor, recorded(9)])).toEqual([])
    // 기록 회차가 두 끝 카드보다 이르면 늦은 끝 카드(3화)를 따르고, 기록 회차가 없으면 두 끝 카드만 본다.
    expect(publicationOrderIssues([a, b, emperor, recorded(2)]).map((i) => i.visibleFrom)).toEqual([3, 3])
    expect(publicationOrderIssues([a, b, emperor, recorded()]).map((i) => i.visibleFrom)).toEqual([3, 3])
  })

  it('이름의 카드가 늦게 공개돼도 관계를 더 늦게 기록했다면 경고하지 않는다(시연 세계관: 3화에 보호로 바뀌고 세라핀이 3화부터 공개)', () => {
    const [kael, lian, seraphine] = [pub(1, text('카엘', '')), pub(1, text('리안', '')), pub(3, text('세라핀', ''))]
    const guard = (n: number) => link(kael, lian, { title: '보호', text: '세라핀이 시킨 일', fromEpisode: n })
    expect(publicationOrderIssues([kael, lian, seraphine, guard(3)])).toEqual([])
    expect(publicationOrderIssues([kael, lian, seraphine, guard(2)]).map((i) => i.visibleFrom)).toEqual([2, 2])
  })

  it('이미 기록된 시작 회차(recordedFrom)보다 늦춘 N화부터는 기존 연결이 남아 독자에게 기록된 회차부터 보이므로 둘 중 이른 회차로 계산한다 (DEC-51·54)', () => {
    const [a, b] = [pub(1, text('리안', '')), pub(1, text('카엘', ''))]
    const minister = pub(4, text('승상', ''))
    const moved = (fromEpisode: number, recordedFrom?: number) => link(a, b, { title: '동료', text: '승상과도 아는 사이', fromEpisode, ...(recordedFrom !== undefined && { recordedFrom }) })
    const seen = (row: StudioSetting) => publicationOrderIssues([a, b, minister, row]).map((i) => i.visibleFrom)
    expect(seen(moved(5, 3))).toEqual([3, 3]) // 3화에 기록된 관계를 5화로 늦춰도 3화 연결이 남아 3화부터 보인다: 승상(4화부터 공개)보다 이르다
    expect(seen(moved(5))).toEqual([]) // 아직 기록하지 않은 새 관계는 입력한 5화부터다
    expect(seen(moved(5, 5))).toEqual([]) // 기록된 회차와 같으면 그 회차다
    expect(seen(moved(2, 3))).toEqual([2, 2]) // 앞당기면 입력한 회차부터다
  })

  it('게시판 상태는 경고가 있는 카드에 order를 켜고, 경고만 있어도 상태가 있는 카드다', () => {
    const hall = pub(1, card('places', '궁궐', { text: '승상이 산다.' }))
    const minister = pub(5, card('places', '승상'))
    const status = cardStatuses([hall, minister], [])
    expect(status.get(hall.item.id)).toEqual({ cleanup: false, unlinked: false, opinions: 0, order: true })
    expect(status.has(minister.item.id)).toBe(false)
  })
})
