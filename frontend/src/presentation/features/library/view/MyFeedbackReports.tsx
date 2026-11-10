import { useRef, useState } from 'react'

import { REPORT_BODY_MAX, type FeedbackReport } from '../../../../domain/entities/feedbackReport'
import { FeedbackReportCard } from '../../../shared/feedbackReports/FeedbackReportCard'
import { Go } from '../../../shared/Go'
import { useMyFeedbackReportsViewModel } from '../viewmodel/useMyFeedbackReportsViewModel'

type Vm = ReturnType<typeof useMyFeedbackReportsViewModel>

function MyReportRow({ r, vm }: { r: FeedbackReport; vm: Vm }) {
  const [text, setText] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const label = `${r.workTitle} ${r.episodeNumber}화`
  // 처리가 성공하면 눌렀던 버튼이 사라지거나 잠겨도 키보드 위치를 이 행 카드에 둔다(WCAG 2.4.3).
  const settle = (ok: boolean) => { if (ok) card.current?.focus(); return ok }
  return (
    <FeedbackReportCard report={r} showWork ref={card}>
      <div className="acts" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Go to={`/read/${r.workId}/${r.episodeNumber}`} className="btn sm" aria-label={`회차 보기 · ${label}`}>회차 보기</Go>
        <button type="button" className="btn sm" aria-label={`${r.visibility === 'public' ? '비공개로 바꾸기' : '공개로 바꾸기'} · ${label}`} disabled={vm.busy}
          onClick={() => void vm.setVisibility(r, r.visibility === 'public' ? 'private' : 'public').then(settle)}>{r.visibility === 'public' ? '비공개로 바꾸기' : '공개로 바꾸기'}</button>
        {!r.withdrawn && <button type="button" className="btn sm" aria-label={`철회 · ${label}`} disabled={vm.busy} onClick={() => void vm.withdraw(r).then(settle)}>철회</button>}
      </div>
      {!r.withdrawn && (
        <details style={{ marginTop: 8 }}>
          <summary aria-label={`정정하기 · ${label}`}>정정하기</summary>
          <form onSubmit={(ev) => { ev.preventDefault(); void vm.correct(r, text).then((ok) => { if (settle(ok)) setText('') }) }}>
            <label className="field">정정 내용
              <textarea className="ta" aria-label={`정정 내용 · ${label}`} maxLength={REPORT_BODY_MAX} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <p className="small muted">원문은 그대로 남고 정정이 덧붙어요. 철회한 뒤에는 정정할 수 없어요.</p>
            <button type="submit" className="btn sm pri" aria-label={`정정 남기기 · ${label}`} disabled={vm.busy || !text.trim()}>정정 남기기</button>
          </form>
        </details>
      )}
    </FeedbackReportCard>
  )
}

/**
 * 내 서재 ‘내 댓글·제보’ 탭의 내 제보(기능 23). 실제 작품에 남긴 제보를 최신순으로 보이고 공개 범위 변경·정정·철회를 서버로 보냅니다.
 * 데모 작품의 피드백 기록은 같은 탭의 기존 메모리 목록이 그대로 보입니다.
 */
export function MyFeedbackReports() {
  const vm = useMyFeedbackReportsViewModel()
  const { reports } = vm
  return (
    <section className="sec" aria-label="내 제보" aria-busy={!reports && !vm.isError}>
      <div className="sec-h"><h2>{reports ? `내 제보 ${reports.length}` : '내 제보'}</h2></div>
      <p className="small muted">실제 작품에 남긴 피드백이에요. 작가가 확인하거나 답변하면 상태가 바뀌어요. 공개 범위는 철회한 뒤에도 바꿀 수 있어요.</p>
      {vm.isError && (
        <div role="alert">
          <p>제보 목록을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {!reports && !vm.isError && <p className="muted">제보를 불러오고 있어요…</p>}
      {reports?.length === 0 && <p className="muted">남긴 제보가 없어요. 소설 회차에서 문장을 눌러 피드백을 보내 보세요.</p>}
      {!!reports?.length && <div className="list">{reports.map((r) => <MyReportRow key={r.id} r={r} vm={vm} />)}</div>}
    </section>
  )
}
