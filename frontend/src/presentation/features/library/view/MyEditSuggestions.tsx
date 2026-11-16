import { SuggestionDiff, SuggestionStatusChip } from '../../../shared/editSuggestion/SuggestionParts'
import { useMyEditSuggestionsViewModel } from '../viewmodel/useMyEditSuggestionsViewModel'

/**
 * 내 서재 '내 댓글·신고' 탭의 내 수정 제안(기능 24). 상태만 읽습니다.
 * 승인돼도 독자에게 보이려면 작가가 발행해야 하므로 초안 반영과 발행을 구분해 안내합니다.
 */
export function MyEditSuggestions() {
  const vm = useMyEditSuggestionsViewModel()
  return (
    <section className="sec" aria-labelledby="my-edit-suggestions-h" aria-busy={!vm.items && !vm.isError}>
      <div className="sec-h"><h2 id="my-edit-suggestions-h">내 수정 제안</h2></div>
      {vm.isError && (
        <div className="panel" role="alert">
          <p>수정 제안을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>수정 제안 다시 불러오기</button>
        </div>
      )}
      {!vm.items && !vm.isError && <p className="muted">수정 제안을 불러오고 있어요…</p>}
      {vm.items?.length === 0 && <div className="list"><div className="rp muted">소설 본문에서 문장을 누르고 '수정 제안'을 보내면 여기에 모여요.</div></div>}
      {vm.items && vm.items.length > 0 && (
        <div className="list" id="mysuggestions">{vm.items.map((s) => (
          <div className="rp" key={s.id}>
            <div className="top"><b>{s.workTitle} {s.episodeNumber}화 · 수정 제안</b><SuggestionStatusChip s={s} /></div>
            <SuggestionDiff before={s.beforeText} after={s.afterText} />
            {s.editedText && <div className="small">작가가 고친 문장: {s.editedText}</div>}
            {s.reason && <div className="small muted">사유: {s.reason}</div>}
            {s.status === 'rejected' && <div className="a">작가가 거절했어요{s.decisionReason ? ` · ${s.decisionReason}` : ''}</div>}
            {s.status === 'approved' && s.applyResult === 'applied' && <div className="a">작가가 승인해 초안에 반영했어요. 독자에게는 작가가 발행해야 보여요.</div>}
            {s.status === 'approved' && s.applyResult === 'failed' && <div className="a">작가가 승인했지만 아직 초안에 반영되지 않았어요. 작가가 직접 고칠 수 있어요.</div>}
          </div>
        ))}</div>
      )}
    </section>
  )
}
