import { useForkManagement } from '../viewmodel/useForkManagement'
import { Go } from '../../../shared/Go'
import { useServerWorks } from '../viewmodel/useServerWorks'
import './server-writing.css'

/** 팀 서재의 카드와 진입 경로를 사용하되 데모 데이터와 합치지 않는다. */
export function ServerWritingList() {
  const vm = useServerWorks()
  const fork = useForkManagement(vm.works, vm.reload)
  const { works } = fork
  const locked = fork.busy || vm.loading // 다시 불러오는 동안에는 예전 카드에 관리 동작을 겹쳐 보내지 않는다.
  return <section className="server-writing" aria-label="저장한 작품" aria-busy={vm.loading}>
    <div className="sec-h"><h2>저장한 작품</h2><button type="button" className="btn sm" disabled={vm.loading} onClick={vm.reload}>새로고침</button></div>
    <button type="button" className="btn sm" aria-pressed={fork.forkOnly} onClick={() => fork.setForkOnly(!fork.forkOnly)}>내 포크만 보기</button>
    {fork.notice && <p role="status" tabIndex={-1} ref={fork.resultRef}>{fork.notice}</p>}
    {fork.error && <p role="alert" tabIndex={-1} ref={fork.resultRef}>{fork.error}</p>}
    {vm.error ? <p role="alert">{vm.error} 새로고침으로 다시 확인해 주세요.</p>
      : vm.loading && !vm.works.length ? <p role="status">작품을 불러오고 있어요…</p>
      : fork.forkOnly && !works.length ? <p className="note2">아직 만든 포크가 없어요.</p>
      : !works.length ? <p className="note2">아직 서버에 저장된 작품이 없어요. {import.meta.env.MODE === 'mockup' ? '아래 새 소설 등록은 현재 데모이며 서버 등록 연결은 준비 중이에요.' : '아래에서 새 소설을 시작해 보세요.'}</p>
      : works.map(work => <article className="mywork" key={work.id}>
        <div className="server-writing-content"><h3>{work.title}</h3><p className="small muted">{work.summary}</p>
          <div className="tags"><span className="chip">{work.visibility === 'public' ? '공개 중' : '비공개'}</span>{work.source && <span className="chip">Fork · {work.source.title} {work.source.episode}화에서</span>}</div>
          <div className="acts"><Go className="btn sm pri" to={`/studio/${work.id}`}>집필실 열기</Go></div>
          {work.source && <details>
            <summary>포크 상세 및 관리</summary>
            <p>{work.source.deleted ? '삭제된 원작' : '원작'} 「{work.source.title}」 · {work.source.episode}화 기준 · 버전 {work.source.version}</p>
            {work.source.direction && <p>분기 방향 · {work.source.direction}</p>}
            <form key={`${work.title}\n${work.summary}`} onSubmit={event => {
              event.preventDefault()
              const fields = new FormData(event.currentTarget)
              void fork.update(work, String(fields.get('title') ?? ''), String(fields.get('summary') ?? ''))
            }}>
              <label className="field">포크 제목<input className="inp" name="title" defaultValue={work.title} maxLength={120} required /></label>
              <label className="field">소개<textarea className="inp" name="summary" defaultValue={work.summary} maxLength={2000} /></label>
              <button type="submit" className="btn sm" disabled={locked || work.revision === undefined}>기본 정보 저장</button>
            </form>
            {work.visibility === 'public' && <button type="button" className="btn sm" disabled={locked} onClick={() => void fork.stop(work.id)}>포크 공개 중단</button>}
            <button type="button" className="btn sm" disabled={locked} onClick={() => void fork.remove(work)}>포크 삭제</button>
          </details>}
        </div>
      </article>)}
  </section>
}
