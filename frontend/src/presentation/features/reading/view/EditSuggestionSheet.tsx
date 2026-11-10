import { useState } from 'react'

import { SUGGESTION_MAX } from '../../../../domain/entities/editSuggestion'
import type { Sentence } from '../../../../domain/entities/feedback'
import { Sheet } from '../../../shared/Sheet'
import { useEditSuggestionViewModel } from '../viewmodel/useEditSuggestionViewModel'

/**
 * 실제 작품(Content) 문장 수정 제안 시트(기능 24). 고른 문장이 고칠 문장(변경 전)이고, 고친 문장을 미리 채워 두어 그 자리에서 고칩니다.
 * 등록하면 작가의 피드백함에 들어가며 작가가 승인해야 초안에 반영됩니다. 실패하면 입력을 지우지 않습니다.
 */
export function EditSuggestionSheet({ workId, n, sentence, onClose }: { workId: string; n: number; sentence: Sentence; onClose: () => void }) {
  const vm = useEditSuggestionViewModel(workId, n)
  const [after, setAfter] = useState(sentence.t)
  const [reason, setReason] = useState('')
  return (
    <Sheet sid="U06" label="문장 수정 제안" onClose={onClose}>
      <div className="sh-h"><h3>✎ 수정 제안 · {n}화</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="quote">{sentence.t}</div>
      <label className="field">고친 문장<textarea className="ta" aria-label="고친 문장" data-autofocus maxLength={SUGGESTION_MAX} value={after} onChange={(e) => setAfter(e.target.value)} /></label>
      <label className="field">사유 (선택)<textarea className="ta" aria-label="수정 사유" maxLength={SUGGESTION_MAX} placeholder="왜 고치면 좋은지 적어 주세요" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="note">작가가 승인해야 원고에 반영돼요. 승인해도 발행은 작가가 따로 하며, 자동 반영은 없어요.</div>
      <div className="rowend">
        <button type="button" className="btn" onClick={onClose}>취소</button>
        <button type="button" className="btn pri" disabled={vm.busy} onClick={() => { void vm.propose(sentence.t, after, reason).then((ok) => { if (ok) onClose() }) }}>수정 제안 보내기</button>
      </div>
    </Sheet>
  )
}
