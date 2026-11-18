import { stripCardLinks } from './cardLinks'
import { characterDocName, characterDocText, missingCharacterDocs, withCharacterDoc, type CharacterDocKey } from './characterDocs'
import { cardTypeOf, cardTypes } from './studioCards'
import { editStudioSetting } from './studioRelations'
import { cardRevealEpisode, type StudioSetting } from './studioWorld'

/*
 * 설정집 AI 검토(#394): 저장한 초안의 설정끼리의 모순·인물 문서가 제 역할대로 쓰였는지·빠진 정보를 AI가 지적한다. 결과는 저장하지 않는 화면 상태다.
 * 이 파일은 Content 응답의 모양과, 화면이 즉시 계산하는 게시판 상태(`연결 필요`·`공개 순서 확인`·`AI 의견 N`)·수정안 반영 규칙을 순수 함수로 둔다.
 */

export type ReviewFindingKind = 'contradiction' | 'doc_role' | 'missing_info' | 'other'
export const FINDING_KINDS: Record<ReviewFindingKind, string> = { contradiction: '설정 충돌', doc_role: '인물 문서 역할', missing_info: '빠진 정보', other: '기타 의견' }
/**
 * 지적마다 AI가 낼 수 있는 수정안: 카드 하나의 한 칸을 바꿀 **바꾼 뒤 전체 글**이다. `body`는 카드 본문(인물이면 IDENTITY.md), `soul`·`goal`·`episode`(회차 번호)는 인물 문서다.
 * AI가 카드를 직접 고치지 않는다: 작가가 `초안에 반영`을 눌러 승인한 것만 편집 초안에 들어가고, 세계관 저장으로 서버에 반영된다(DEC-36).
 */
export type ReviewFix = { cardId: string; text: string } & ({ target: 'body' | 'soul' | 'goal' } | { target: 'episode'; episode: number })
export type ReviewFinding = { cardIds: string[]; kind: ReviewFindingKind; message: string; fix?: ReviewFix }
/** `reviewedCards < totalCards`이면 한 번에 보낼 수 있는 분량을 넘은 카드는 검토하지 못한 것이다. 응답의 `draftRevision`·`model`은 화면이 쓰지 않아 읽지 않는다. */
export type WorldReview = { reviewedCards: number; totalCards: number; findings: ReviewFinding[] }

/** 게시판 한 줄의 보완 상태. `cleanup`은 빈 인물 문서(`정리 필요`), `unlinked`는 `연결 필요`, `order`는 `공개 순서 확인`, `opinions`는 마지막 AI 검토가 그 카드에 남긴 지적 수다. */
export type CardStatus = { cleanup: boolean; unlinked: boolean; opinions: number; order: boolean }

/**
 * `연결 필요`인 카드 id: 사건·사물 카드가 어느 인물과도 **승인된 긍정 관계**로 이어지지 않았다. 시뮬레이션은 관계로 이어진 사건·사물만 인물이 기억하기 때문이다
 * ([시뮬레이션 계약](../../../../docs/design/character-simulation-contract.md): 부정 관계는 연결이 아니다). 상대가 초안에 있는 인물 카드일 때만 이어진 것으로 센다(삭제한 카드·인물이 아닌 카드는 아니다).
 */
export function unlinkedCardIds(settings: readonly StudioSetting[]): Set<string> {
  const characters = new Set(settings.filter((s) => cardTypeOf(s.item) === 'character').map((s) => s.item.id))
  const linked = new Set<string>()
  for (const { item } of settings) {
    if (item.kind !== 'relation' || item.polarity !== 'asserted' || item.decision !== 'approved' || !item.subjectId || !item.targetId) continue
    if (characters.has(item.subjectId)) linked.add(item.targetId)
    if (characters.has(item.targetId)) linked.add(item.subjectId)
  }
  return new Set(settings.filter((s) => ['event', 'object'].includes(cardTypeOf(s.item)) && !linked.has(s.item.id)).map((s) => s.item.id))
}

/**
 * 공개 순서 경고 하나(DEC-53)다. `cardId`는 그 글이 있는 카드이고(관계 문구는 두 끝 카드마다 한 건), `source`는 카드 본문(링크 글자 포함)인지 관계의 label·body인지다.
 * `named`는 글에 이름(제목·별칭)이 나온 다른 카드이고 `from`이 없으면 작가 전용(가장 늦은 회차)이다. `visibleFrom`은 그 글이 독자에게 보이기 시작하는 회차다.
 */
export type OrderIssue = { cardId: string; source: 'body' | 'relation'; relationId?: string; name: string; named: { cardId: string; title: string; from?: number }; visibleFrom: number }

/**
 * 공개 순서 점검([계약](../../../../docs/design/world-review-contract.md#공개-순서-규칙--dec-53)): 모델 없이 저장 전 초안에서 계산한다. 카드 C의 본문(링크 글자 포함, 링크의 id는 뺀다)과 C를 끝점으로 하는 관계의 label·body에
 * 다른 카드 D의 제목·별칭이 나오고 D의 유효 공개 회차가 그 글이 독자에게 보이기 시작하는 회차보다 늦으면 알린다. 작가 전용 D는 가장 늦은 회차로 본다.
 * C가 작가 전용이면 독자에게 보이지 않으므로 점검하지 않고, 관계 문구는 두 끝 카드 가운데 늦은 회차부터 보이는 것으로 본다(관계의 기록 회차는 초안에 없어 쓰지 않는다).
 * 부분 문자열 일치라 짧은 이름은 잘못 잡힐 수 있다. 같은 글에서 같은 카드는 한 번만(제목이 별칭보다 먼저) 알린다.
 * ponytail: 카드 수의 제곱 번 includes를 한다(수백 장은 문제없다). 천 장을 넘어 입력이 밀리면 본문이 바뀐 카드만 다시 센다.
 */
export function publicationOrderIssues(settings: readonly StudioSetting[]): OrderIssue[] {
  const cards = settings.filter((s) => cardTypes.some((t) => t.id === cardTypeOf(s.item)))
  const from = new Map(cards.map((s) => [s.item.id, cardRevealEpisode(s)]))
  const names = cards.map((card) => ({ card, list: [card.item.title, ...(card.aliases ?? [])].map((n) => n.trim()).filter(Boolean) }))
  const issues: OrderIssue[] = []
  const scan = (text: string, visibleFrom: number, add: (name: string, named: OrderIssue['named']) => void) => {
    for (const { card, list } of names) {
      const when = from.get(card.item.id)
      if (when !== undefined && when <= visibleFrom) continue
      const name = list.find((n) => text.includes(n))
      if (name) add(name, { cardId: card.item.id, title: card.item.title, ...(when !== undefined && { from: when }) })
    }
  }
  for (const { item } of cards) {
    const visibleFrom = from.get(item.id)
    if (visibleFrom !== undefined) scan(stripCardLinks(item.text), visibleFrom, (name, named) => issues.push({ cardId: item.id, source: 'body', name, named, visibleFrom }))
  }
  for (const { item } of settings) {
    const [subject, target] = [item.subjectId, item.targetId].map((id) => (id ? from.get(id) : undefined))
    if (item.kind !== 'relation' || subject === undefined || target === undefined) continue
    const visibleFrom = Math.max(subject, target)
    scan(stripCardLinks(`${item.title}\n${item.text}`), visibleFrom, (name, named) => { for (const cardId of [item.subjectId!, item.targetId!]) issues.push({ cardId, source: 'relation', relationId: item.id, name, named, visibleFrom }) })
  }
  return issues
}

/** 카드마다의 보완 상태(`정리 필요`·`연결 필요`·`공개 순서 확인`·`AI 의견 N`). 상태가 하나도 없는 카드는 담지 않는다. 여러 카드를 가리킨 지적은 가리킨 카드마다 한 건이다. */
export function cardStatuses(settings: readonly StudioSetting[], findings: readonly ReviewFinding[], order: readonly OrderIssue[] = publicationOrderIssues(settings)): Map<string, CardStatus> {
  const unlinked = unlinkedCardIds(settings)
  const ordered = new Set(order.map((issue) => issue.cardId))
  const opinions = new Map<string, number>()
  for (const { cardIds } of findings) for (const id of new Set(cardIds)) opinions.set(id, (opinions.get(id) ?? 0) + 1)
  const statuses = new Map<string, CardStatus>()
  for (const row of settings) {
    const status = { cleanup: missingCharacterDocs(row).length > 0, unlinked: unlinked.has(row.item.id), opinions: opinions.get(row.item.id) ?? 0, order: ordered.has(row.item.id) }
    if (status.cleanup || status.unlinked || status.opinions || status.order) statuses.set(row.item.id, status)
  }
  return statuses
}

/** 그 카드를 가리킨 지적. `id`는 검토가 준 목록에서의 번호라 반영·반영 안 함 표시의 열쇠로 쓴다. */
export const cardFindings = (findings: readonly ReviewFinding[], cardId: string) =>
  findings.flatMap((finding, id) => (finding.cardIds.includes(cardId) ? [{ id, finding }] : []))

/** `ready`는 반영할 수 있다, `stale`은 검토 뒤 그 칸의 글이 바뀌었다, `missing`은 칸을 찾을 수 없다(카드를 지웠거나 인물 문서를 인물이 아닌 카드에 달았다). */
export type ReviewFixState = 'ready' | 'stale' | 'missing'
export const REVIEW_FIX_BLOCKED = { stale: '검토 뒤 바뀐 설정이라 반영할 수 없어요', missing: '바꿀 칸을 찾을 수 없어 반영할 수 없어요' } as const

const docKey = (fix: ReviewFix): CharacterDocKey => (fix.target === 'body' ? 'identity' : fix.target === 'episode' ? fix.episode : fix.target)
const findCard = (settings: readonly StudioSetting[], id: string) => settings.find((s) => s.item.id === id && s.item.kind !== 'relation')
/** 수정안이 가리키는 칸의 지금 글. 칸이 없으면(카드가 없거나, 인물 문서인데 인물이 아니다) undefined다. */
export function reviewFixField(settings: readonly StudioSetting[], fix: ReviewFix): string | undefined {
  const row = findCard(settings, fix.cardId)
  return row && (fix.target === 'body' || cardTypeOf(row.item) === 'character') ? characterDocText(row, docKey(fix)) : undefined
}

/** 수정안을 지금 초안에 반영할 수 있는지. 검토 때(`reviewed`)와 지금의 그 칸 글이 같아야 한다: 다르면 작가가 그 뒤에 고친 글을 덮어쓰게 된다. */
export function reviewFixState(fix: ReviewFix, reviewed: readonly StudioSetting[], current: readonly StudioSetting[]): ReviewFixState {
  const now = reviewFixField(current, fix)
  return now === undefined ? 'missing' : now === reviewFixField(reviewed, fix) ? 'ready' : 'stale'
}

/**
 * 수정안이 가리키는 칸 하나만 바꾼 초안. 반영할 수 없으면(`reviewFixState`) 이유를 던지고 초안은 그대로다. 글이 이미 같으면 같은 목록을 돌려준다.
 * 본문은 `editStudioSetting`의 작가 수정이고, 인물 문서는 `withCharacterDoc`으로 그 문서만 바꾼다(없던 회차 기억은 새로 생긴다).
 */
export function applyReviewFix(settings: StudioSetting[], fix: ReviewFix, reviewed: readonly StudioSetting[]): StudioSetting[] {
  const state = reviewFixState(fix, reviewed, settings)
  if (state !== 'ready') throw new Error(REVIEW_FIX_BLOCKED[state])
  if (reviewFixField(settings, fix) === fix.text) return settings
  if (fix.target === 'body') return editStudioSetting(settings, fix.cardId, { text: fix.text })
  const row = findCard(settings, fix.cardId)!
  return editStudioSetting(settings, fix.cardId, {}, { characterDocs: withCharacterDoc(row.characterDocs, fix.target === 'episode' ? fix.episode : fix.target, fix.text) })
}

/** 수정안이 바꿀 칸의 이름: 인물 문서는 파일 이름(`SOUL.md`·`memory/03회차.md`), 카드 본문은 인물이면 `IDENTITY.md`, 그 밖은 `설정 본문`이다. */
export const reviewFixName = (row: StudioSetting | undefined, fix: ReviewFix) =>
  fix.target === 'body' && row && cardTypeOf(row.item) !== 'character' ? '설정 본문' : characterDocName(docKey(fix))

const two = (n: number) => String(n).padStart(2, '0')
/** 검토를 받은 시각(`HH:mm`, 이 브라우저의 로컬 시각). */
export const reviewClock = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`
/** `AI 의견 N건 · 카드 M장 · HH:mm 검토` */
export const reviewSummary = (review: WorldReview, at: Date) => `AI 의견 ${review.findings.length}건 · 카드 ${review.reviewedCards}장 · ${reviewClock(at)} 검토`
/** 전체 카드보다 적게 검토했을 때만 그 사실을 알리는 문장(아니면 빈 글). */
export const reviewPartialNote = ({ reviewedCards, totalCards }: WorldReview) =>
  reviewedCards < totalCards ? `카드 ${totalCards}장 중 ${reviewedCards}장만 검토했어요. 한 번에 보낼 수 있는 분량을 넘은 카드는 검토하지 못했어요.` : ''
