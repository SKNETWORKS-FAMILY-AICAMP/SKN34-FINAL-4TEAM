import { useState } from 'react'
import { appContainer } from '../../../../app/appContainer'
import { useAsyncData } from '../../../shared/useAsyncData'

const size = 20

export function CommentFeedbackInbox({ workId, episodes }: {
  workId: string
  episodes: ReadonlyArray<{ number: number; title: string }>
}) {
  const [open, setOpen] = useState<number | null>(() => episodes.length === 1 ? episodes[0].number : null)
  return <section aria-label="댓글 피드백">
    <h3>댓글 피드백</h3>
    {episodes.length === 0 ? <p>공개된 회차가 없어요.</p> : <ol className="tcard eps ep-list feedback-episode-list">
      {episodes.map(e => <li key={e.number}>
        <button type="button" className="ep feedback-episode-toggle" aria-expanded={open === e.number}
          aria-label={`${e.number}화 ${e.title} 댓글 피드백 ${open === e.number ? '접기' : '보기'}`}
          onClick={() => setOpen(open === e.number ? null : e.number)}>
          <span className="no">{e.number}</span>
          <span><b>{e.title}</b><span className="d">{e.number}화</span></span>
          <span aria-hidden="true">{open === e.number ? '접기 ▴' : '보기 ▾'}</span>
        </button>
        {open === e.number && <EpisodeFeedback key={e.number} workId={workId} episode={e.number} />}
      </li>)}
    </ol>}
  </section>
}

function EpisodeFeedback({ workId, episode }: { workId: string; episode: number }) {
  const [offset, setOffset] = useState(0)
  const commentFeedback = appContainer.resolve('commentFeedback')
  const result = useAsyncData(
    signal => commentFeedback(workId, episode, offset, size, signal),
    [commentFeedback, workId, episode, offset],
  )
  return <div className="feedback-episode-comments">
    {result.isLoading && <p role="status">댓글을 불러오는 중이에요.</p>}
    {result.isError && <p role="alert">댓글을 불러오지 못했어요. <button className="btn sm" onClick={result.retry}>다시 시도</button></p>}
    {result.data && <>
      <p>댓글 피드백 {result.data.total}건</p>
      {result.data.items.map(item => <article key={item.id}>

        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</p>
      </article>)}
      {offset > 0 && <button className="btn sm" onClick={() => setOffset(offset - size)}>이전</button>}
      {offset + size < result.data.total && <button className="btn sm" onClick={() => setOffset(offset + size)}>다음</button>}
    </>}
  </div>
}
