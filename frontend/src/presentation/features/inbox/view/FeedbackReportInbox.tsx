import { useRef, useState } from 'react'

import { REPORT_RESPONSE_MAX, REPORT_STATUS_LABEL, SETTABLE_REPORT_STATUSES, type FeedbackReport } from '../../../../domain/entities/feedbackReport'
import { FeedbackReportCard } from '../../../shared/feedbackReports/FeedbackReportCard'
import { Go } from '../../../shared/Go'
import { useFeedbackReportInboxViewModel } from '../viewmodel/useFeedbackReportInboxViewModel'

type Vm = ReturnType<typeof useFeedbackReportInboxViewModel>

function InboxReportRow({ r, vm }: { r: FeedbackReport; vm: Vm }) {
  const [answer, setAnswer] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  // 고르는 중인 처리 상태. 고르는 것만으로는 저장하지 않고 '상태 변경'을 눌러야 보낸다(WCAG 3.2.2). null이면 서버 값을 보인다.
  const [pick, setPick] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const label = `${r.workTitle} ${r.episodeNumber}화`
  const chosen = pick ?? r.status
  const next = SETTABLE_REPORT_STATUSES.find((s) => s === chosen)
  // 확인 전에는 '확인했어요'가 확인함으로 바꾸는 방법이라, 같은 뜻의 '확인함'은 상태 선택지에서 뺀다.
  const unchecked = r.status === 'unchecked'
  // 처리가 성공하면 눌렀던 버튼이 사라지거나 잠겨도 키보드 위치를 이 행 카드에 둔다(WCAG 2.4.3).
  const settle = (ok: boolean) => { if (ok) card.current?.focus(); return ok }
  return (
    <FeedbackReportCard report={r} showWork ref={card}>
      <div className="acts" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Go to={`/read/${r.workId}/${r.episodeNumber}`} className="btn sm" aria-label={`회차 보기 · ${label}`}>회차 보기</Go>
        {unchecked && <button type="button" className="btn sm" aria-label={`확인했어요 · ${label}`} disabled={vm.busy} onClick={() => void vm.check(r).then(settle)}>확인했어요</button>}
        <label className="small">처리 상태{' '}
          <select className="inp sm" aria-label={`처리 상태 · ${label}`} disabled={vm.busy} value={chosen} onChange={(e) => setPick(e.target.value)}>
            <option value="unchecked" disabled>{REPORT_STATUS_LABEL.unchecked}</option>
            {SETTABLE_REPORT_STATUSES.filter((s) => !(unchecked && s === 'checked')).map((s) => <option key={s} value={s}>{REPORT_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <button type="button" className="btn sm" aria-label={`상태 변경 · ${label}`} disabled={vm.busy || !next || next === r.status}
          onClick={() => { if (next) void vm.setStatus(r, next).then((ok) => { setPick(null); return settle(ok) }) }}>상태 변경</button>
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
    // 다른 섹션과 같은 .sec/.sec-h 제목이다. 이 섹션은 화면의 첫 섹션이라 위쪽 간격(.sec의 margin-top)만 없앤다.
    <section className="sec" aria-label="독자 제보" aria-busy={!reports && !vm.isError} style={{ marginTop: 0, marginBottom: 18 }}>
      <div className="sec-h"><h2>{reports ? `독자 제보 ${reports.length}` : '독자 제보'}</h2></div>
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
