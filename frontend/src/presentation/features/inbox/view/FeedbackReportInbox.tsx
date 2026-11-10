import { useRef, useState } from 'react'

import { REPORT_RESPONSE_MAX, REPORT_STATUS_LABEL, SETTABLE_REPORT_STATUSES, type FeedbackReport } from '../../../../domain/entities/feedbackReport'
import { FeedbackReportCard } from '../../../shared/feedbackReports/FeedbackReportCard'
import { Go } from '../../../shared/Go'
import { useFeedbackReportInboxViewModel } from '../viewmodel/useFeedbackReportInboxViewModel'

type Vm = ReturnType<typeof useFeedbackReportInboxViewModel>

function InboxReportRow({ r, vm }: { r: FeedbackReport; vm: Vm }) {
  const [answer, setAnswer] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const label = `${r.workTitle} ${r.episodeNumber}화`
  // 처리가 성공하면 눌렀던 버튼이 사라지거나 잠겨도 키보드 위치를 이 행 카드에 둔다(WCAG 2.4.3).
  const settle = (ok: boolean) => { if (ok) card.current?.focus(); return ok }
  return (
    <FeedbackReportCard report={r} showWork ref={card}>
      <div className="acts" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Go to={`/read/${r.workId}/${r.episodeNumber}`} className="btn sm" aria-label={`회차 보기 · ${label}`}>회차 보기</Go>
        {!r.authorChecked && <button type="button" className="btn sm" aria-label={`확인했어요 · ${label}`} disabled={vm.busy} onClick={() => void vm.check(r).then(settle)}>확인했어요</button>}
        <label className="small">처리 상태{' '}
          <select className="inp sm" aria-label={`처리 상태 · ${label}`} disabled={vm.busy} value={r.status}
            onChange={(e) => { const next = SETTABLE_REPORT_STATUSES.find((s) => s === e.target.value); if (next) void vm.setStatus(r, next).then(settle) }}>
            <option value="unchecked" disabled>{REPORT_STATUS_LABEL.unchecked}</option>
            {SETTABLE_REPORT_STATUSES.map((s) => <option key={s} value={s}>{REPORT_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary aria-label={`답변하기 · ${label}`}>답변하기</summary>
        <form onSubmit={(ev) => { ev.preventDefault(); void vm.answer(r, answer, isPublic).then((ok) => { if (settle(ok)) { setAnswer(''); setIsPublic(false) } }) }}>
          <label className="field">작가 답변
            <textarea className="ta" aria-label={`작가 답변 · ${label}`} maxLength={REPORT_RESPONSE_MAX} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <label className="ck"><input type="checkbox" aria-label={`공개 답변 · ${label}`} checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> 공개 답변</label>
          <p className="small muted">비공개 제보여도 공개 답변은 답변만 다른 독자에게 보여요.</p>
          <button type="submit" className="btn sm pri" aria-label={`답변 보내기 · ${label}`} disabled={vm.busy || !answer.trim()}>답변 보내기</button>
        </form>
      </details>
    </FeedbackReportCard>
  )
}

/**
 * 작가 피드백함의 실제 작품 독자 제보(기능 23). 내가 소유한 작품들의 제보를 최신순으로 보이고 확인·답변(공개 여부)·처리 상태 변경을 서버로 보냅니다.
 * 독자가 철회·정정한 제보는 원문을 지우지 않고 표시만 남겨 함께 보입니다. 데모 작품의 피드백은 같은 화면의 기존 메모리 목록이 그대로 보입니다.
 */
export function FeedbackReportInbox() {
  const vm = useFeedbackReportInboxViewModel()
  const { reports } = vm
  return (
    // .panel 대신 .list 카드를 쓴다(데모 피드백 패널과 구분되고, 데모 패널의 aria-busy를 첫 .panel로 읽는 기존 테스트도 그대로 맞는다).
    <section aria-label="독자 제보" aria-busy={!reports && !vm.isError} style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 6 }}>{reports ? `독자 제보 ${reports.length}` : '독자 제보'}</h2>
      <p className="small muted">내 작품 회차에 독자가 남긴 제보예요. 확인하거나 답변하면 독자의 내 서재에 상태가 바로 표시돼요. 비공개 제보는 작가만 볼 수 있고, 공개 답변을 달면 답변만 다른 독자에게 보여요.</p>
      {vm.isError && (
        <div role="alert">
          <p>독자 제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {!reports && !vm.isError && <p className="muted">독자 제보를 불러오고 있어요…</p>}
      {reports?.length === 0 && <p className="muted">접수된 독자 제보가 없어요.</p>}
      {!!reports?.length && <div className="list">{reports.map((r) => <InboxReportRow key={r.id} r={r} vm={vm} />)}</div>}
    </section>
  )
}
