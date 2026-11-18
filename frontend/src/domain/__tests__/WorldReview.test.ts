import { describe, expect, it } from 'vitest'

import { characterDocText } from '../entities/characterDocs'
import { newSetting, type CharacterDocs, type SettingItem, type StudioSetting } from '../entities/studioWorld'
import {
  applyReviewFix, cardFindings, cardStatuses, publicationOrderIssues, REVIEW_FIX_BLOCKED, reviewClock, reviewFixName, reviewFixState, reviewPartialNote, reviewSummary, unlinkedCardIds,
  type ReviewFinding, type ReviewFix, type WorldReview,
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
    const empty = person('빈 인물') // IDENTITY는 있으나 SOUL·GOAL이 비어 정리 필요
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

const fixOf = (cardId: string, target: ReviewFix['target'], text = '바꾼 글', episode?: number): ReviewFix =>
  (target === 'episode' ? { cardId, target, text, episode: episode ?? 0 } : { cardId, target, text })

describe('수정안 반영: 대상 칸을 찾고, 검토 뒤 바뀌었으면 잠그고, 초안의 그 칸만 바꾼다', () => {
  it('body는 카드 본문(인물이면 IDENTITY.md)만 바꾸고 다른 카드·칸은 그대로 둔다', () => {
    const a = person('가람', { soul: '말수가 적다' })
    const b = place('성')
    const before = [a, b]
    const after = applyReviewFix(before, fixOf(a.item.id, 'body', '새 본문'), before)
    expect(after[0].item.text).toBe('새 본문')
    expect(after[0].characterDocs).toEqual(a.characterDocs)
    expect(after[1]).toBe(b)
    expect(a.item.text).toBe('가람 본문') // 입력은 건드리지 않는다
    expect(applyReviewFix([b], fixOf(b.item.id, 'body', '성 새 본문'), [b])[0].item.text).toBe('성 새 본문')
  })

  it.each(['soul', 'goal'] as const)('%s는 인물 문서 그 칸만 바꾼다', (target) => {
    const a = person('가람', { soul: '말수가 적다', goal: '스승을 찾는다', episodes: { 1: '스승을 잃었다' } })
    const [after] = applyReviewFix([a], fixOf(a.item.id, target, '새 글'), [a])
    expect(after.characterDocs).toEqual({ ...a.characterDocs, [target]: '새 글' })
    expect(after.item.text).toBe(a.item.text)
  })

  it('episode는 그 회차 기억만 바꾸고 아직 없는 회차는 새로 만든다', () => {
    const a = person('가람', { episodes: { 1: '스승을 잃었다' } })
    const [edited] = applyReviewFix([a], fixOf(a.item.id, 'episode', '스승의 유품을 얻었다', 1), [a])
    expect(edited.characterDocs?.episodes).toEqual({ 1: '스승의 유품을 얻었다' })
    const [created] = applyReviewFix([a], fixOf(a.item.id, 'episode', '새 기억', 3), [a])
    expect(created.characterDocs?.episodes).toEqual({ 1: '스승을 잃었다', 3: '새 기억' })
    expect(characterDocText(created, 3)).toBe('새 기억')
    const bare = person('문서 없는 인물') // characterDocs가 아예 없는 인물도 그 칸으로 시작한다
    expect(applyReviewFix([bare], fixOf(bare.item.id, 'goal', '목표'), [bare])[0].characterDocs).toEqual({ soul: '', goal: '목표', episodes: {} })
  })

  it('검토 때와 지금의 그 칸 글이 같으면 ready, 다르면 stale이며 stale은 반영하지 않고 이유를 던진다', () => {
    const a = person('가람', { soul: '말수가 적다', episodes: { 1: '스승을 잃었다' } })
    const reviewed = [a]
    const edited = (change: Partial<StudioSetting>, text = a.item.text): StudioSetting[] => [{ ...a, ...change, item: { ...a.item, text } }]
    expect(reviewFixState(fixOf(a.item.id, 'body'), reviewed, reviewed)).toBe('ready')
    // 본문만 바뀌었을 때 다른 칸(SOUL)의 수정안은 여전히 반영할 수 있다
    expect(reviewFixState(fixOf(a.item.id, 'soul'), reviewed, edited({}, '다른 본문'))).toBe('ready')
    expect(reviewFixState(fixOf(a.item.id, 'body'), reviewed, edited({}, '다른 본문'))).toBe('stale')
    expect(reviewFixState(fixOf(a.item.id, 'soul'), reviewed, edited({ characterDocs: { ...a.characterDocs!, soul: '말수가 많다' } }))).toBe('stale')
    expect(reviewFixState(fixOf(a.item.id, 'episode', '', 1), reviewed, edited({ characterDocs: { ...a.characterDocs!, episodes: { 1: '고쳐 씀' } } }))).toBe('stale')
    const current = edited({}, '다른 본문')
    expect(() => applyReviewFix(current, fixOf(a.item.id, 'body'), reviewed)).toThrow(REVIEW_FIX_BLOCKED.stale)
    expect(REVIEW_FIX_BLOCKED.stale).toBe('검토 뒤 바뀐 설정이라 반영할 수 없어요')
  })

  it('지워진 카드·인물이 아닌 카드의 인물 문서 칸은 missing이라 반영하지 않는다', () => {
    const [a, castle] = [person('가람'), place('성')]
    expect(reviewFixState(fixOf(a.item.id, 'body'), [a], [castle])).toBe('missing')
    for (const target of ['soul', 'goal', 'episode'] as const) {
      expect(reviewFixState(fixOf(castle.item.id, target), [castle], [castle])).toBe('missing')
      expect(() => applyReviewFix([castle], fixOf(castle.item.id, target), [castle])).toThrow(REVIEW_FIX_BLOCKED.missing)
    }
    // 관계 행의 id는 카드가 아니다
    const relation = link(a, castle)
    expect(reviewFixState(fixOf(relation.item.id, 'body'), [a, castle, relation], [a, castle, relation])).toBe('missing')
  })

  it('검토 때 없던 카드(검토 뒤 인물로 바뀐 카드 포함)에는 반영하지 않는다', () => {
    const castle = place('성')
    const becameCharacter = { ...castle, item: { ...castle.item, kind: 'entity' as const, entityType: 'character' } }
    expect(reviewFixState(fixOf(castle.item.id, 'soul'), [castle], [becameCharacter])).toBe('stale')
  })

  it('수정안이 지금 글과 같으면 초안을 바꾸지 않고 같은 목록을 돌려준다', () => {
    const a = person('가람')
    const settings = [a]
    expect(applyReviewFix(settings, fixOf(a.item.id, 'body', a.item.text), settings)).toBe(settings)
  })
})

const review = (over: Partial<WorldReview> = {}): WorldReview => ({ reviewedCards: 40, totalCards: 40, findings: [finding([crypto.randomUUID()]), finding([crypto.randomUUID()])], ...over })

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

  it('AI 의견 N건 · 카드 M장 · HH:mm 검토', () => {
    expect(reviewSummary(review(), at)).toBe('AI 의견 2건 · 카드 40장 · 09:05 검토')
    expect(reviewSummary(review({ findings: [], reviewedCards: 0, totalCards: 0 }), new Date(2026, 10, 16, 23, 59))).toBe('AI 의견 0건 · 카드 0장 · 23:59 검토')
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

  it('게시판 상태는 경고가 있는 카드에 order를 켜고, 경고만 있어도 상태가 있는 카드다', () => {
    const hall = pub(1, card('places', '궁궐', { text: '승상이 산다.' }))
    const minister = pub(5, card('places', '승상'))
    const status = cardStatuses([hall, minister], [])
    expect(status.get(hall.item.id)).toEqual({ cleanup: false, unlinked: false, opinions: 0, order: true })
    expect(status.has(minister.item.id)).toBe(false)
  })
})
