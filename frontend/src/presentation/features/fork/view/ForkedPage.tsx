import { useParams } from 'react-router'

import { Art } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useForkedViewModel } from '../viewmodel/useForkedViewModel'

/** 목업 forked(id): U10 포크 생성 완료 · 스냅샷 */
export function ForkedPage() {
  const { id = '' } = useParams()
  const d = useForkedViewModel(id)
  if (d === undefined) return null
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
        <div className="snap"><div><small>복사한 회차</small><b>{snap.eps.length}화</b></div><div><small>복사한 인물</small><b>{snap.cast.length}명</b></div><div><small>복사한 사건·규칙</small><b>{snap.events.length} · {snap.rules.length}</b></div></div>
        <div className="note" style={{ textAlign: 'left' }}>이 소설의 설정은 원작에서 <b>복사본(스냅샷)</b>으로 분리됐어요. 여기서 인물 상태나 사건을 바꿔도 원작은 그대로이고, 원작이 나중에 수정돼도 이 소설의 1~{f.forkAt}화는 바뀌지 않아요. <span className="mono">snapshot #{snap.srcHash}</span></div>
        <div className="rowend" style={{ justifyContent: 'center', marginTop: 18 }}><Go to="/lib?tab=write" className="btn">내가 쓰는 소설로</Go><Go to={`/studio/${f.id}`} className="btn pri" id="toStudio">집필실로 가기 →</Go></div>
      </div></div>
    </div>
  )
}
