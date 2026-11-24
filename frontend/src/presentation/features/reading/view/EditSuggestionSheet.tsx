import { useId, useState } from 'react'
import { useLocation } from 'react-router'

import { SUGGESTION_MAX } from '../../../../domain/entities/editSuggestion'
import type { Sentence } from '../../../../domain/entities/feedback'
import { Go } from '../../../shared/Go'
import { Sheet } from '../../../shared/Sheet'
import { useEditSuggestionViewModel } from '../viewmodel/useEditSuggestionViewModel'
import { SheetReceipt } from './SheetReceipt'

/**
 * 실제 작품(Content) 문장 수정 제안 시트(기능 24). 고른 문장이 고칠 문장(변경 전)이고, 고친 문장을 미리 채워 두어 그 자리에서 고칩니다.
 * 등록하면 작가의 피드백함에 들어가며 작가가 승인해야 초안에 반영됩니다. 실패하면 입력을 지우지 않고 시트 안에서 알립니다.
 */
export function EditSuggestionSheet({ workId, n, sentence, onClose }: { workId: string; n: number; sentence: Sentence; onClose: () => void }) {
  const vm = useEditSuggestionViewModel(workId, n)
  const [after, setAfter] = useState(sentence.t)
  const [reason, setReason] = useState('')
  const hint = useId()
  const { pathname } = useLocation()
  // 비었거나 원문과 같으면 보낼 수 없다(UseCase·서버도 같은 규칙으로 거절한다).
  const unchanged = !after.trim() || after.trim() === sentence.t.trim()
  return (
    <Sheet sid="U06" label="문장 수정 제안" onClose={onClose}>
      <div className="sh-h"><h3>✎ 수정 제안 · {n}화</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="quote">{sentence.t}</div>
      <label className="field">고친 문장<textarea className="ta" data-autofocus maxLength={SUGGESTION_MAX} readOnly={vm.done} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
      <label className="field">사유 (선택)<textarea className="ta" maxLength={SUGGESTION_MAX} readOnly={vm.done} placeholder="왜 고치면 좋은지 적어 주세요" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {vm.done ? (
        <SheetReceipt status="검토 대기" onClose={onClose} message={<>
          수정 제안을 보냈어요. 작가가 검토하면 상태가 바뀌어요. 계정 메뉴의 <Go to="/content?view=reports" state={{ back: pathname }}>내 제보·수정 제안</Go>에서 확인할 수 있어요.
        </>} />
      ) : (
        <>
          <div className="note">작가가 승인하면 초안에서 원문을 찾아 반영해요. 원문이 없거나 여러 곳에 있으면 작가가 직접 확인해요. 발행은 작가가 따로 해요.</div>
          {vm.error && <p role="alert">{vm.error}</p>}
          {unchanged && <p id={hint} className="small muted">원래 문장과 달라야 보낼 수 있어요.</p>}
          <div className="rowend">
            <button type="button" className="btn" onClick={onClose}>취소</button>
            <button type="button" className="btn pri" disabled={vm.busy || unchanged} aria-describedby={unchanged ? hint : undefined} onClick={() => { void vm.propose(sentence.t, after, reason) }}>수정 제안 보내기</button>
          </div>
        </>
      )}
    </Sheet>
  )
}
