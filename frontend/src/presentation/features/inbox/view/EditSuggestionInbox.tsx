import { useEffect, useRef, useState } from 'react'

import { BASE_CHANGED_MESSAGE, SUGGESTION_MAX, type EditSuggestion } from '../../../../domain/entities/editSuggestion'
import { Go } from '../../../shared/Go'
import { SuggestionDiff, SuggestionStatusChip } from '../../../shared/editSuggestion/SuggestionParts'
import { useEditSuggestionInboxViewModel } from '../viewmodel/useEditSuggestionInboxViewModel'

type Vm = ReturnType<typeof useEditSuggestionInboxViewModel>

function SuggestionCard({ s, vm }: { s: EditSuggestion; vm: Vm }) {
  const shown = s.editedText ?? s.afterText
  const [edited, setEdited] = useState(shown)
  const [reason, setReason] = useState('')
  const note = useRef<HTMLParagraphElement>(null)
  const mine = vm.notice?.id === s.id ? vm.notice : null
  // 처리한 버튼이 사라지거나 잠겨 초점을 잃어도 결과 안내에서 이어 가게 합니다.
  useEffect(() => { if (mine) note.current?.focus() }, [mine])
  const undecided = s.status === 'pending' || s.status === 'held'
  const retryable = s.status === 'approved' && s.applyResult === 'failed'
  const locked = vm.pending !== null
  // 서버에 저장하지 않은 편집안이 있으면 승인돼도 그 문장이 반영되지 않으므로, 먼저 저장하게 승인을 잠근다(앞뒤 공백은 저장 때 잘리므로 무시).
  const unsaved = edited.trim() !== shown
  const hint = `unsaved-${s.id}`
  return (
    <article className="panel" style={{ display: 'grid', gap: 12 }} aria-label={`${s.workTitle} ${s.episodeNumber}화 수정 제안`} aria-busy={vm.pending === s.id}>
      <div className="top"><b>{s.workTitle} {s.episodeNumber}화 · 수정 제안</b> <SuggestionStatusChip s={s} /></div>
      <p className="small muted">{s.proposerName}{s.reason ? ` · 사유: ${s.reason}` : ''}</p>
      <SuggestionDiff before={s.beforeText} after={shown} />
      {s.editedText && <p className="small muted">제안자가 처음 올린 수정: {s.afterText}</p>}
      <p className="small">범위 검사 <span className={`chip ${s.scope === 'auto' ? 'ok' : 'wait'}`}>{s.scope === 'auto' ? '표기 교정 수준' : '내용 변경 포함'}</span> {s.scopeReasons.join(' ')}</p>
      <p className="small muted">검사는 표시만 해요. 승인해야만 초안에 반영돼요.</p>
      {undecided && (
        <>
          <label className="field">편집안<textarea className="ta" maxLength={SUGGESTION_MAX} readOnly={locked} value={edited} onChange={(e) => setEdited(e.target.value)} /></label>
          <div className="rowend"><button type="button" className="btn sm" disabled={locked} onClick={() => void vm.saveEditedText(s, edited)}>편집안 저장</button></div>
          <label className="field">거절 사유 (선택)<input className="inp" maxLength={SUGGESTION_MAX} readOnly={locked} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="rowend">
            {s.status === 'pending' && <button type="button" className="btn" disabled={locked} onClick={() => void vm.hold(s)}>보류</button>}
            <button type="button" className="btn" disabled={locked} onClick={() => void vm.reject(s, reason)}>거절</button>
            <button type="button" className="btn pri" disabled={locked || unsaved} aria-describedby={unsaved ? hint : undefined} onClick={() => void vm.approve(s)}>승인하고 초안에 반영</button>
          </div>
          {unsaved && <p id={hint} className="small muted">편집안을 먼저 저장해 주세요.</p>}
        </>
      )}
      {s.status === 'approved' && s.applyResult === 'applied' && (
        <div className="rowend"><span className="chip ok">초안에 반영됨 — 발행은 집필실에서</span><Go to={`/studio/${s.workId}`} className="btn sm">집필실 열기</Go></div>
      )}
      {retryable && (
        <>
          <p role="note" className="note">반영 실패: {s.applyFailure}</p>
          <div className="rowend">
            <Go to={`/studio/${s.workId}`} className="btn sm">집필실에서 직접 고치기</Go>
            <button type="button" className="btn pri" disabled={locked} onClick={() => void vm.approve(s)}>다시 반영 시도</button>
          </div>
        </>
      )}
      {s.status === 'rejected' && s.decisionReason && <p className="small muted">거절 사유: {s.decisionReason}</p>}
      {mine && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <p ref={note} role={mine.ok ? 'status' : 'alert'} tabIndex={-1}>{mine.msg}</p>
          {mine.msg === BASE_CHANGED_MESSAGE && <Go to={`/studio/${s.workId}`} className="btn sm">집필실 열기</Go>}
        </div>
      )}
    </article>
  )
}

/**
 * 작가 피드백함의 실제 작품 수정 제안(기능 24): 변경 전·후, 범위 검사, 편집안 저장, 승인·거절·보류와 반영 결과.
 * 승인은 새 초안 버전으로만 반영하며 발행은 집필실에서 따로 합니다. 데모 작품의 수정 제안은 위의 데모 피드백함이 계속 맡습니다.
 */
export function EditSuggestionInbox() {
  const vm = useEditSuggestionInboxViewModel()
  return (
    <section className="sec" aria-labelledby="edit-suggestions-h" aria-busy={!vm.items && !vm.isError}>
      <div className="sec-h"><h2 id="edit-suggestions-h">독자 수정 제안</h2><span className="muted small">내 서버 작품의 문장 수정 제안</span></div>
      {vm.isError && (
        <div className="panel" role="alert">
          <p>수정 제안을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {!vm.items && !vm.isError && <p className="muted">수정 제안을 불러오고 있어요…</p>}
      {vm.items?.length === 0 && <p className="muted">받은 수정 제안이 없어요.</p>}
      {vm.items && vm.items.length > 0 && <div style={{ display: 'grid', gap: 12 }}>{vm.items.map((s) => <SuggestionCard key={s.id} s={s} vm={vm} />)}</div>}
    </section>
  )
}
