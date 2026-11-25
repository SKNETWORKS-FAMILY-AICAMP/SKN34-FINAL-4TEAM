import { useEffect, useId, useRef } from 'react'

import { docFillLineText } from '../../../../domain/entities/characterDocs'
import type { useCharacterDocs } from '../viewmodel/useCharacterDocs'

type Fill = NonNullable<ReturnType<typeof useCharacterDocs>['fill']>

/**
 * 비어 있는 정체성·성격·말투 문서의 '원고로 채우기 제안'(#847, [계약](../../../../../../docs/design/world-review-contract.md)): 연결된 소설의 저장 원고에서 이 인물이 나온 문장을 AI가 골라 줄로 제안한다.
 * 새로 쓰지 않고 원고에 있는 문장만 회차와 함께 보이며, 제안이 도착한 것은 저장도 반영도 아니다: `초안에 반영`을 눌러야 편집 초안의 문서가 바뀌고 세계관을 저장해야 서버에 닿는다(DEC-36).
 * 원고 일부를 OpenAI로 보내므로 동의에 체크해야 요청할 수 있고, 소설이 연결되지 않았거나 저장하지 않은 변경이 있으면 이유와 함께 잠근다.
 * 진행(`role="status"`)·실패(서버 문구, `role="alert"`)·근거 없음(`원고에서 근거가 되는 문장을 찾지 못했어요`)·제안을 실제 결과대로 알린다. 요청이 끝나면 그 결과 문장으로 초점을 옮긴다.
 */
export function DocFill({ fill }: { fill: Fill }) {
  const reason = useId()
  const outcome = useRef<HTMLParagraphElement>(null) // 마지막 요청의 결과 문장(실패·근거 없음·제안 안내)
  const was = useRef(fill.running)
  useEffect(() => {
    if (was.current && !fill.running) outcome.current?.focus()
    was.current = fill.running
  }, [fill.running])
  const { proposal } = fill
  const found = !!proposal && proposal.lines.length > 0
  return (
    <section className="world-findings" aria-label="원고로 채우기 제안" aria-busy={fill.running}>
      <h4>원고로 채우기 제안 <span className="small muted">AI가 원고에서 문장을 골라요</span></h4>
      {!found && (
        <>
          <p className="small muted">비어 있어요. 연결된 소설의 저장 원고에서 이 인물이 나온 문장을 AI가 골라 제안할 수 있어요. 새로 쓰지 않고 원고에 있는 문장만 보여 주며, 반영해도 세계관을 저장해야 서버에 닿아요.</p>
          <label className="world-consent">
            <input type="checkbox" checked={fill.consent} disabled={fill.running} onChange={(e) => fill.setConsent(e.target.checked)} />
            <span>원고 중 이 인물이 나온 부분을 OpenAI로 보내고 API 비용이 드는 데 동의해요.</span>
          </label>
          <div className="world-finding-actions">
            <button type="button" className="btn sm" disabled={!fill.consent || !!fill.lock || fill.running} aria-describedby={fill.lock ? reason : undefined} onClick={fill.request}>
              {proposal ? '다시 제안받기' : fill.error ? '다시 시도' : '원고로 채우기 제안'}
            </button>
            {fill.lock && <span id={reason} className="small muted">{fill.lock}</span>}
          </div>
        </>
      )}
      {fill.running && <p role="status">원고에서 근거 문장을 찾고 있어요. 1분쯤 걸릴 수 있어요.</p>}
      {fill.error && <p ref={outcome} tabIndex={-1} role="alert" className="world-error">{fill.error}</p>}
      {proposal && !found && !fill.running && !fill.error && <p ref={outcome} tabIndex={-1} role="status">원고에서 근거가 되는 문장을 찾지 못했어요. 직접 써 주세요.</p>}
      {found && !fill.running && (
        <>
          <p ref={outcome} tabIndex={-1} className="small">원고에서 찾은 문장이에요. 반영하면 편집 초안에 들어가고, 세계관을 저장해야 서버에 반영돼요.</p>
          <ul>
            {proposal.lines.map((line) => (
              <li key={`${line.episode}:${line.quote}`}><span className="chip">{line.episode}화</span> {docFillLineText(line)}</li>
            ))}
          </ul>
          {proposal.skipped > 0 && <p className="small muted">원고에서 확인하지 못한 {proposal.skipped}줄은 뺐어요.</p>}
          <div className="world-finding-actions">
            <button type="button" className="btn pri sm" disabled={fill.busy} onClick={fill.apply}>초안에 반영</button>
            <button type="button" className="btn sm" onClick={fill.decline}>반영하지 않기</button>
          </div>
        </>
      )}
    </section>
  )
}
