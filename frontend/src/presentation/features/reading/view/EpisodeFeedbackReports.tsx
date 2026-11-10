import { FeedbackReportCard } from '../../../shared/feedbackReports/FeedbackReportCard'
import { useEpisodeFeedbackReportsViewModel } from '../viewmodel/useEpisodeFeedbackReportsViewModel'

/**
 * 실제 작품(Content) 회차의 독자 제보 영역(기능 23). 공개 제보와 작가의 공개 답변이 있는 제보를 읽기 전용으로 보여 주고,
 * 제보 등록은 문장 팝업의 피드백 시트가 맡습니다. 회차가 바뀌면 호출 측이 key로 새로 만들어 요청 상태를 비웁니다.
 */
export function EpisodeFeedbackReports({ workId, n, refresh }: { workId: string; n: number; refresh: number }) {
  const vm = useEpisodeFeedbackReportsViewModel(workId, n, refresh)
  const { reports } = vm
  return (
    <section className="tcard cms" aria-label="독자 제보" aria-busy={!reports && !vm.isError}>
      <h3>{reports ? `제보 ${reports.length}` : '제보'}</h3>
      <p className="small muted">공개한 제보와 작가가 공개 답변을 단 제보가 보여요. 문장을 눌러 피드백을 보낼 수 있어요.</p>
      {vm.isError && (
        <div role="alert">
          <p className="muted">제보를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {!reports && !vm.isError && <p className="muted">제보를 불러오고 있어요…</p>}
      {reports?.length === 0 && <p className="muted">아직 공개된 제보가 없어요.</p>}
      {!!reports?.length && <div className="list">{reports.map((r) => <FeedbackReportCard key={r.id} report={r} />)}</div>}
    </section>
  )
}
