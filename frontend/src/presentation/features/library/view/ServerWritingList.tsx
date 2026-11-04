import { Go } from '../../../shared/Go'
import { useServerWorks } from '../viewmodel/useServerWorks'
import './server-writing.css'

/** 팀 서재의 카드와 진입 경로를 사용하되 데모 데이터와 합치지 않는다. */
export function ServerWritingList() {
  const vm = useServerWorks()
  return <section className="server-writing" aria-label="저장한 작품">
    <div className="sec-h"><h2>저장한 작품</h2><button type="button" className="btn sm" disabled={vm.loading} onClick={vm.reload}>새로고침</button></div>
    {vm.loading ? <p role="status">작품을 불러오고 있어요…</p>
      : vm.error ? <p role="alert">{vm.error} 새로고침으로 다시 확인해 주세요.</p>
      : !vm.works.length ? <p className="note2">아직 서버에 저장된 작품이 없어요. 아래 새 소설 등록은 현재 데모이며 서버 등록 연결은 준비 중이에요.</p>
      : vm.works.map(work => <article className="mywork" key={work.id}>
        <div className="server-writing-content"><h3>{work.title}</h3><p className="small muted">{work.summary}</p>
          <div className="tags"><span className="chip">{work.visibility === 'public' ? '공개 중' : '비공개'}</span>{work.source && <span className="chip">Fork · {work.source.title} {work.source.episode}화에서</span>}</div>
          <div className="acts"><Go className="btn sm pri" to={`/studio/${work.id}`}>집필실 열기</Go></div>
        </div>
      </article>)}
  </section>
}
