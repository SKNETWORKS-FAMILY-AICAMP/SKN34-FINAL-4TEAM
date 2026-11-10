import { suggestionStatus, type EditSuggestion } from '../../../domain/entities/editSuggestion'

/** 변경 전·후 문장을 나란히 보입니다(.diff 스타일). 작가 피드백함과 내 서재의 수정 제안 화면이 함께 씁니다. */
export function SuggestionDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="diff">
      <div className="o"><small>지금</small><del>{before}</del></div>
      <div className="n"><small>바꾸면</small><ins>{after}</ins></div>
    </div>
  )
}

/** 승인 상태와 초안 반영 결과를 한 칩으로 보입니다. */
export function SuggestionStatusChip({ s }: { s: Pick<EditSuggestion, 'status' | 'applyResult'> }) {
  const { label, tone } = suggestionStatus(s)
  return <span className={`chip${tone === 'off' ? '' : ` ${tone}`}`}>{label}</span>
}
