import { Go } from '../../../shared/Go'
import { SuggestionDiff, SuggestionStatusChip } from '../../../shared/editSuggestion/SuggestionParts'
import { useMyEditSuggestionsViewModel } from '../viewmodel/useMyEditSuggestionsViewModel'

/**
 * ‘내 제보·수정 제안’ 화면의 내 수정 제안(기능 24). 상태만 읽습니다.
 * 승인돼도 독자에게 보이려면 작가가 발행해야 하므로 초안 반영과 발행을 구분해 안내합니다.
 * embedded는 작품 관리의 '내 제보·수정 제안' 탭 안이다: 탭 제목(h2) 아래 묶음 제목이라 h3다(그 밖에는 쪽 제목(h1) 아래 구획이라 h2).
 */
export function MyEditSuggestions({ embedded = false }: { embedded?: boolean }) {
  const vm = useMyEditSuggestionsViewModel()
  const Heading = embedded ? 'h3' : 'h2'
  return (
    <section className="sec" aria-labelledby="my-edit-suggestions-h" aria-busy={!vm.items && !vm.isError}>
      <div className="sec-h"><Heading id="my-edit-suggestions-h">내 수정 제안</Heading></div>
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
            {s.status === 'held' && <div className="a">작가가 판단을 보류했어요. 원고에는 아직 반영되지 않았어요.</div>}
            {s.status === 'rejected' && <div className="a">작가가 거절했어요{s.decisionReason ? ` · ${s.decisionReason}` : ''}</div>}
            {s.status === 'approved' && s.applyResult === 'applied' && <div className="a">{s.published ? <>현재 공개된 회차에 반영됐어요. <Go to={`/read/${s.workId}/${s.episodeNumber}`} aria-label={`회차 보기 · ${s.workTitle} ${s.episodeNumber}화`}>회차 보기</Go></> : '작가가 승인해 초안에 반영했어요. 독자에게는 작가가 발행해야 보여요.'}</div>}
            {s.status === 'approved' && s.applyResult === 'failed' && <div className="a">작가가 승인했지만 아직 초안에 반영되지 않았어요. 작가가 직접 고칠 수 있어요.</div>}
          </div>
        ))}</div>
      )}
    </section>
  )
}
