import { useDemoReportsViewModel } from '../viewmodel/useDemoReportsViewModel'
import { MyEditSuggestions } from './MyEditSuggestions'
import { MyFeedbackReports } from './MyFeedbackReports'

/** 내 댓글·제보: 서버 제보(기능 23)·데모 피드백·서버 수정 제안(기능 24). 작품 관리(`/content?view=reports`)에서 연다. */
export function MyCommentsReports() {
  const reports = useDemoReportsViewModel()
  const mockup = import.meta.env.MODE === 'mockup'
  return (
    <section aria-labelledby='my-comments-reports'>
      <h1 id='my-comments-reports'>내 댓글·제보</h1>
      <MyFeedbackReports />
      {!!reports?.length && <section className='sec' aria-label='데모 작품 피드백'><div className='sec-h'><h2>데모 작품 피드백 · 서버에 저장되지 않아요</h2></div><div className='list' id='myreports'>{reports.map((r) => (
        <div className='rp' key={r.id}><div className='top'><b>{r.title} {r.n ? `${r.n}화` : '소설 전체'} · {r.type}</b><span className={`chip ${/완료|반영/.test(r.status) ? 'ok' : 'wait'}`}>{r.status}</span></div><div className='small' style={{ marginTop: 4 }}>{r.text}</div><div className='a'>🤖 {r.reply}</div></div>
      ))}</div></section>}
      <p className='muted small' style={{ marginTop: 10 }}>작가가 처리하면 상태가 바뀌어요.</p>
      {!mockup && <MyEditSuggestions />}
    </section>
  )
}
