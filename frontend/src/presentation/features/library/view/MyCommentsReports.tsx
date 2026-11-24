import { useDemoReportsViewModel } from '../viewmodel/useDemoReportsViewModel'
import { MyEditSuggestions } from './MyEditSuggestions'
import { MyFeedbackReports } from './MyFeedbackReports'

/**
 * 내 제보·수정 제안: 서버 제보(기능 23)·데모 피드백·서버 수정 제안(기능 24). 작품 관리 주소(`/content?view=reports`)에서 열고, 작품 관리 메뉴의 '내 제보·수정 제안' 탭에도 같은 내용이 들어간다.
 * embedded는 그 탭 안이다: 탭 제목(h2)이 이미 있어 쪽 제목(h1)은 그리지 않고, 구획 제목(내 제보·내 수정 제안·데모 작품 피드백)은 그 아래 묶음 제목이라 h3다.
 */
export function MyCommentsReports({ embedded = false }: { embedded?: boolean }) {
  const reports = useDemoReportsViewModel()
  const mockup = import.meta.env.MODE === 'mockup'
  const Heading = embedded ? 'h3' : 'h2'
  return (
    <section aria-labelledby={embedded ? undefined : 'my-comments-reports'} aria-label={embedded ? '내 제보·수정 제안' : undefined}>
      {!embedded && <h1 id='my-comments-reports'>내 제보·수정 제안</h1>}
      <MyFeedbackReports embedded={embedded} />
      {!!reports?.length && <section className='sec' aria-label='데모 작품 피드백'><div className='sec-h'><Heading>데모 작품 피드백 · 서버에 저장되지 않아요</Heading></div><div className='list' id='myreports'>{reports.map((r) => (
        <div className='rp' key={r.id}><div className='top'><b>{r.title} {r.n ? `${r.n}화` : '소설 전체'} · {r.type}</b><span className={`chip ${/완료|반영/.test(r.status) ? 'ok' : 'wait'}`}>{r.status}</span></div><div className='small' style={{ marginTop: 4 }}>{r.text}</div><div className='a'>🤖 {r.reply}</div></div>
      ))}</div></section>}
      <p className='muted small' style={{ marginTop: 10 }}>작가가 처리하면 상태가 바뀌어요.</p>
      {!mockup && <MyEditSuggestions embedded={embedded} />}
    </section>
  )
}
