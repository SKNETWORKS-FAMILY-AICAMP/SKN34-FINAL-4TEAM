import { useEffect, useRef, useState } from 'react'

import type { StudioSetting, StudioWorld } from '../../../../domain/entities/studioWorld'
import {
  applyReviewFix, cardFindings, reviewClock, reviewFixField, reviewFixName, reviewFixState, reviewPartialNote, reviewSummary,
  type ReviewFinding, type WorldReview,
} from '../../../../domain/entities/worldReview'
import type { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'

type Handled = 'applied' | 'declined'
/**
 * 마지막 검토 결과(저장하지 않는 화면 상태). 요청할 때 화면이 가진 저장본(`reviewed`)을 함께 들고 있어, 수정안이 그 뒤에 작가가 고친 글을 덮어쓰지 않게 견준다.
 * `handled`는 지적 번호별로 작가가 반영했는지(applied)·반영하지 않기로 했는지(declined)다.
 */
type Result = { world: string; review: WorldReview; at: Date; reviewed: StudioSetting[]; handled: Record<number, Handled> }
const NONE: ReviewFinding[] = []

type Inputs = {
  /** `null`이면 서버 기능이 없는 데모다. */
  useCase: WorldReviewUseCase | null
  saved: StudioWorld | null
  editing: StudioWorld | null
  /** 저장하지 않은 변경(초안·관계 입력)이 있는지. 서버는 저장한 초안을 검토한다. */
  unsaved: boolean
  /** 저장·확정 같은 다른 요청이 진행 중인지 */
  busy: boolean
  /** 편집 초안을 바꾼다(`useWorldStudioViewModel.patch`). */
  patch: (change: Partial<StudioWorld>) => void
}

/**
 * 설정집 AI 검토([계약](../../../../../../docs/design/world-review-contract.md)): OpenAI 전송 동의 → 요청 → 결과(지적·수정안). 결과는 저장하지 않고 세계관이 바뀌면 지운다.
 * 게시판의 `AI 의견 N`·`보완 필요`와 편집 화면의 지적 목록이 같은 결과를 보도록 세계관 ViewModel이 하나만 갖는다.
 * 요청은 서버가 저장한 초안을 읽어 검토하므로 저장하지 않은 변경이 있으면 이유와 함께 잠근다. 수정안은 작가가 `초안에 반영`을 눌러야 편집 초안의 그 칸만 바뀌고(세계관 저장 전에는 서버에 닿지 않는다),
 * 검토 때의 그 칸 글과 지금 글이 다르거나 칸이 없어졌으면 반영하지 않는다(`domain/entities/worldReview`).
 */
export function useWorldReview({ useCase, saved, editing, unsaved, busy, patch }: Inputs) {
  const worldId = saved?.id
  const [consent, setConsent] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const controller = useRef<AbortController | null>(null)
  // 화면을 벗어나거나 다른 세계관으로 옮기면 진행 중인 요청을 취소하고 그 세계관의 실패·결과를 지운다. 화면은 `key` 없이 같은 컴포넌트에서 세계관 id만 바뀌므로,
  // 지우지 않으면 A의 실패 문구가 B의 시트에 남고 A → B → A에서 옛 결과가 되살아난다.
  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
    setRunning(false)
    setError('')
    setResult(null)
  }, [worldId])
  // 지우는 효과는 새 세계관의 첫 그리기 뒤에 도니, 그 사이에도 옛 세계관의 결과가 보이지 않게 세계관으로도 거른다.
  const current = result && result.world === worldId ? result : null
  const lock = !useCase ? '데모에서는 지원하지 않아요.'
    : !saved ? '세계관을 불러온 뒤 요청할 수 있어요.'
    : unsaved ? '저장하지 않은 변경이 있어요. AI는 저장한 초안을 검토하니 먼저 세계관을 저장하세요.'
    : busy ? '다른 요청이 진행 중이에요. 끝난 뒤 요청해 주세요.' : ''
  const request = async () => {
    if (!useCase || !saved || lock || controller.current) return
    const run = new AbortController()
    controller.current = run
    const { id, settings } = saved
    setRunning(true)
    setError('')
    try {
      const review = await useCase.review(id, consent, run.signal)
      if (!run.signal.aborted) setResult({ world: id, review, at: new Date(), reviewed: settings, handled: {} })
    } catch (e) {
      if (!run.signal.aborted) setError(e instanceof Error ? e.message : '설정집 검토를 요청하지 못했어요.')
    } finally {
      if (controller.current === run) {
        controller.current = null
        setRunning(false)
      }
    }
  }
  const mark = (id: number, state: Handled) => setResult((r) => (r && r.world === worldId ? { ...r, handled: { ...r.handled, [id]: state } } : r))
  const now = editing?.settings ?? []
  const row = (id: string) => now.find((s) => s.item.id === id && s.item.kind !== 'relation')
  const titleOf = (id: string) => ({ id, title: row(id)?.item.title || '이름 없는 설정' })
  const findings = current?.review.findings ?? NONE
  return {
    /** 서버 기능이 없는 데모인지 */
    demo: !useCase,
    /** OpenAI 전송·비용 동의(요청마다 다시 받지 않고 이 화면에 머무는 동안 유지한다) */
    consent,
    setConsent,
    running,
    /** 마지막 요청의 실패 문구(서버가 준 그대로) */
    error,
    /** 요청을 막는 이유(요청할 수 있으면 빈 글) */
    lock,
    request,
    /** 마지막 검토의 요약 문구·시각·부분 검토 안내(이 세계관에서 받은 검토가 없으면 null) */
    result: current && { summary: reviewSummary(current.review, current.at), clock: reviewClock(current.at), partial: reviewPartialNote(current.review) },
    /** 마지막 검토의 지적들(없으면 빈 목록). 게시판의 상태 집계가 쓴다. */
    findings,
    /**
     * 그 카드를 가리킨 지적. `fix`는 수정안이 이 카드의 칸을 바꿀 때만 있고(지금 글·상태 포함), 다른 카드의 칸이면 `fixIn`이 그 카드를 가리킨다.
     * `related`는 같은 지적이 함께 가리킨 다른 설정(초안에 남아 있는 것만)이다.
     */
    forCard: (cardId: string) => cardFindings(findings, cardId).map(({ id, finding }) => {
      const { fix } = finding
      const mine = !!fix && fix.cardId === cardId
      return {
        id,
        finding,
        handled: current?.handled[id],
        related: finding.cardIds.filter((other) => other !== cardId && row(other)).map(titleOf),
        fix: mine ? { name: reviewFixName(row(cardId), fix), state: reviewFixState(fix, current!.reviewed, now), now: reviewFixField(now, fix) ?? '', text: fix.text } : undefined,
        fixIn: fix && !mine && row(fix.cardId) ? titleOf(fix.cardId) : undefined,
      }
    }),
    /** 지적 `id`의 수정안을 편집 초안의 그 칸에 반영한다. 반영할 수 없으면(칸의 글이 검토 뒤 바뀜·칸 없음·다른 요청 진행 중·이미 처리함) 아무것도 하지 않는다. */
    apply: (id: number) => {
      const fix = current?.review.findings[id]?.fix
      if (!current || !fix || !editing || busy || current.handled[id]) return
      if (reviewFixState(fix, current.reviewed, editing.settings) !== 'ready') return
      const settings = applyReviewFix(editing.settings, fix, current.reviewed)
      if (settings !== editing.settings) patch({ settings })
      mark(id, 'applied')
    },
    /** 지적 `id`의 수정안을 반영하지 않기로 한다(초안은 그대로, 지적 문장은 남는다). */
    decline: (id: number) => {
      if (current && !current.handled[id]) mark(id, 'declined')
    },
  }
}
