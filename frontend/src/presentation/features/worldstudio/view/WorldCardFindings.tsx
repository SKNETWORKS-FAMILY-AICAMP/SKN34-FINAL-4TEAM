import { useId, useRef, useState } from 'react'

import { FINDING_KINDS, REVIEW_FIX_BLOCKED } from '../../../../domain/entities/worldReview'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 편집 화면 맨 위의 'AI 검토 의견'([계약](../../../../../../docs/design/world-review-contract.md)): 마지막 설정집 AI 검토가 이 카드에 남긴 지적을 검토 시각과 함께 보인다(검토 뒤 카드를 고쳐도 다음 검토 전까지 그대로 남는다).
 * 지적이 여러 카드를 가리키면 함께 지적된 설정으로 옮겨 갈 수 있고, 수정안은 그 칸이 있는 카드(수정안이 가리키는 카드)에서만 반영한다.
 * 수정안이 이 카드의 칸을 바꾸는 것이면 `수정안 보기`로 지금 글과 바꿀 글(바꾼 뒤 전체 글)을 나란히 보이고, `초안에 반영`은 편집 초안의 그 칸만 바꾼다(저장하지 않은 변경이 되고 세계관 저장 전에는 서버에 닿지 않는다).
 * 검토 때의 그 칸 글과 지금 글이 다르거나 칸이 없으면 이유를 알리고 반영을 잠근다(덮어쓰기 방지). 반영한 지적은 `반영함`, 반영하지 않기로 한 지적은 `반영하지 않음`으로 남는다.
 * `초안에 반영`·`반영하지 않기`를 누르면 그 버튼이 사라지므로 초점은 그 지적의 결과 문장(`반영함`·`반영하지 않음`)으로 옮긴다.
 * 지적이 없는 카드에는 이 절이 없다. 카드가 바뀌면 부모가 `key`로 다시 만들어 펼친 수정안이 남지 않는다.
 */
export function WorldCardFindings({ vm, cardId, onOpenCard, onApplied }: { vm: VM; cardId: string; onOpenCard: (id: string) => void; onApplied: () => void }) {
  const base = useId()
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set()) // 수정안을 펼친 지적 번호
  const next = useRef<number | null>(null) // 방금 처리한 지적 번호: 그 결과 문장이 나타나면 초점을 받는다
  const outcome = (id: number) => (el: HTMLParagraphElement | null) => {
    if (el && next.current === id) {
      next.current = null
      el.focus({ preventScroll: true })
    }
  }
  const list = vm.review.forCard(cardId)
  if (!list.length || !vm.review.result) return null
  const toggle = (id: number) => setOpen((current) => new Set(current.has(id) ? [...current].filter((other) => other !== id) : [...current, id]))
  return (
    <section className="world-findings" aria-label="AI 검토 의견">
      <h4>AI 검토 의견 <span className="small muted">{vm.review.result.clock} 검토 · 저장하지 않는 참고 의견이에요</span></h4>
      <ul>
        {list.map(({ id, finding, handled, related, fix, fixIn }) => (
          <li key={id} className="world-finding">
            <p className="world-finding-message"><span className="chip wait">{FINDING_KINDS[finding.kind]}</span> {finding.message}</p>
            {related.length > 0 && (
              <p className="small muted">함께 지적된 설정: {related.map((other) => <button key={other.id} type="button" className="world-finding-link" onClick={() => onOpenCard(other.id)}>{other.title}</button>)}</p>
            )}
            {fixIn && <p className="small muted">수정안은 ‘{fixIn.title}’ 설정에서 반영할 수 있어요.</p>}
            {fix && handled === 'applied' && <p ref={outcome(id)} tabIndex={-1} className="small"><span className="chip ok">반영함</span> <span className="muted">{fix.name} 칸을 초안에 반영했어요. 세계관을 저장해야 서버에 반영돼요.</span></p>}
            {fix && handled === 'declined' && <p ref={outcome(id)} tabIndex={-1} className="small"><span className="chip">반영하지 않음</span></p>}
            {fix && !handled && (
              <>
                <button type="button" className="btn sm" aria-expanded={open.has(id)} aria-controls={`${base}-${id}`} onClick={() => toggle(id)}>수정안 보기</button>
                {open.has(id) && (
                  <div id={`${base}-${id}`} className="world-finding-fix">
                    <p className="small muted world-finding-field">{fix.name} 칸을 아래 글로 바꿔요(바꾼 뒤 전체 글).</p>
                    <div className="world-finding-diff">
                      <section aria-label="지금 글"><h5>지금 글</h5><pre>{fix.now || '(비어 있음)'}</pre></section>
                      <section aria-label="바꿀 글"><h5>바꿀 글</h5><pre>{fix.text}</pre></section>
                    </div>
                    {fix.state !== 'ready' && <p id={`${base}-${id}-why`} className="small world-field-error">{REVIEW_FIX_BLOCKED[fix.state]}</p>}
                    <div className="world-finding-actions">
                      <button type="button" className="btn pri sm" disabled={fix.state !== 'ready' || vm.busy} aria-describedby={fix.state !== 'ready' ? `${base}-${id}-why` : undefined} onClick={() => { vm.review.apply(id); onApplied(); next.current = id }}>초안에 반영</button>
                      <button type="button" className="btn sm" onClick={() => { vm.review.decline(id); next.current = id }}>반영하지 않기</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
