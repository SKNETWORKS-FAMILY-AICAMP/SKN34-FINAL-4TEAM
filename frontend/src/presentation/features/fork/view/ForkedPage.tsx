import { useParams } from 'react-router'

import { Art } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useForkedViewModel } from '../viewmodel/useForkedViewModel'

/** 목업 forked(id): U10 포크 생성 완료 · 스냅샷 */
export function ForkedPage() {
  const { id = '' } = useParams()
  const vm = useForkedViewModel(id)
  const d = vm.data
  if (d === undefined) return <><Gnb/><main className="wrap"><ContentLoadState failed={vm.isError} retry={vm.retry}/></main></>
  if (d === null) {
    return (
      <>
        <Gnb />
        <main className="wrap"><div className="panel"><h1>소설을 찾을 수 없거나 볼 수 없어요.</h1><Go to="/" className="btn">홈으로</Go></div></main>
        <Footer />
      </>
    )
  }
  const { fork: f, parent: p } = d
  const snap = f.snap!
  return (
    <div className={`calm calm-${f.theme}`} style={{ minHeight: '100vh' }}>
      <div className="band" style={{ height: 300 }}><Art theme={f.theme} w={1200} h={300} seed={f.id + 'band'} /></div>
      <div className="fork"><div className="tcard okbox">
        <div className="big">✎</div><h2>포크 소설을 만들었어요</h2><p className="muted">「{f.title}」 · 원작 「{p.title}」 {f.forkAt}화 끝에서 포크</p>
        {f.canonical ? <div className="note" style={{textAlign:'left'}}>원작의 {f.forkAt}화와 서버에 저장된 기준 버전으로 생성했어요. 설정은 최초 수정 전까지 허용된 원본 변경을 따라가며, 독립 후 변경 반영은 별도 선택이에요. 관계의 과거 스냅샷·복원은 지원하지 않아요.</div> : <>
          <div className="snap"><div><small>복사한 회차</small><b>{snap.eps.length}화</b></div><div><small>복사한 인물</small><b>{snap.cast.length}명</b></div><div><small>복사한 사건·규칙</small><b>{snap.events.length} · {snap.rules.length}</b></div></div>
          <div className="note" style={{ textAlign: 'left' }}>이 소설의 설정은 원작에서 <b>복사본(스냅샷)</b>으로 분리됐어요. 여기서 인물 상태나 사건을 바꿔도 원작은 그대로이고, 원작이 나중에 수정돼도 이 소설의 1~{f.forkAt}화는 바뀌지 않아요. <span className="mono">snapshot #{snap.srcHash}</span></div>
        </>}
        <div className="rowend" style={{ justifyContent: 'center', marginTop: 18 }}><Go to="/lib?tab=write" className="btn">내가 쓰는 소설로</Go><Go to={`/studio/${f.id}`} className="btn pri" id="toStudio">집필실로 가기 →</Go></div>
      </div></div>
    </div>
  )
}
