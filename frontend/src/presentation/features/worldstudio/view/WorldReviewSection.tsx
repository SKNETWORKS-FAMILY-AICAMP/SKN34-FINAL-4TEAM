import { useEffect, useId, useRef } from 'react'

import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'

type Review = ReturnType<typeof useWorldStudioViewModel>['review']

/**
 * `AI 검토` 시트 맨 위의 '설정집 검토' 절([계약](../../../../../../docs/design/world-review-contract.md)): 저장한 설정 카드를 AI가 읽고 설정끼리의 모순·인물 문서의 역할·빠진 정보를 지적한다. 소설을 연결하지 않아도 된다.
 * 카드 내용을 OpenAI로 보내므로 동의에 체크해야 `설정집 검토 요청`을 보낼 수 있고, 서버가 저장한 초안을 읽으므로 저장하지 않은 변경이 있으면 이유를 보이며 잠근다(데모는 서버 기능이 없어 늘 잠긴다).
 * 진행(`role="status"`)·실패(서버 문구, `role="alert"`, 버튼이 `다시 시도`로 바뀌고 이전 요약은 숨는다)·완료(`AI 의견 N건 · 카드 M장 · HH:mm 검토`, 일부 카드만 검토했으면 그 사실)를 실제 결과대로 알리고,
 * 요청이 끝나면 잠겼다 풀린 버튼 대신 그 결과 문장으로 초점을 옮긴다(시트를 다시 열 때는 옮기지 않는다). 지적은 이 시트가 아니라 게시판의 카드 줄(`AI 의견 N`)과 그 카드의 편집 화면에서 본다.
 */
export function WorldReviewSection({ review }: { review: Review }) {
  const reason = useId()
  const outcome = useRef<HTMLParagraphElement>(null) // 마지막 요청의 결과 문장(실패면 알림, 아니면 요약)
  const was = useRef(review.running)
  useEffect(() => {
    if (was.current && !review.running) outcome.current?.focus()
    was.current = review.running
  }, [review.running])
  return (
    <section className="world-review-ask" aria-label="설정집 검토" aria-busy={review.running}>
      <h3>설정집 검토</h3>
      <p>저장한 설정 카드를 AI가 읽고 설정끼리의 모순, 인물 문서(SOUL·GOAL·회차 기억)가 제 역할대로 쓰였는지, 사건의 회차·참여 인물 같은 빠진 정보를 지적해요. 결과는 저장하지 않고 설정집 게시판의 카드 줄에 ‘AI 의견’으로 보여요.</p>
      <label className="world-consent">
        <input type="checkbox" checked={review.consent} disabled={review.demo || review.running} onChange={(e) => review.setConsent(e.target.checked)} />
        <span>저장한 설정 카드의 내용을 OpenAI로 보내고 API 비용이 드는 데 동의해요.</span>
      </label>
      <div className="initial-actions">
        <button type="button" className="btn pri" disabled={!review.consent || !!review.lock || review.running} aria-describedby={review.lock ? reason : undefined} onClick={() => void review.request()}>
          {review.error ? '다시 시도' : review.result ? '다시 검토 요청' : '설정집 검토 요청'}
        </button>
        {review.lock && <span id={reason} className="small muted">{review.lock}</span>}
      </div>
      {review.running && <p role="status">AI가 설정집을 검토하고 있어요. 카드가 많으면 1~2분쯤 걸려요.</p>}
      {review.error && <p ref={outcome} tabIndex={-1} role="alert" className="world-error">{review.error}</p>}
      {review.result && !review.running && !review.error && (
        <>
          <p ref={outcome} tabIndex={-1} role="status">{review.result.summary}</p>
          {review.result.partial && <p className="small">{review.result.partial}</p>}
          <p className="small muted">{review.findings.length ? '카드 줄의 ‘AI 의견’을 누르면 그 카드의 지적과 수정안을 볼 수 있어요.' : '지적한 문제가 없어요.'}</p>
        </>
      )}
    </section>
  )
}
