import { Navigate, useParams, useSearchParams } from 'react-router'

import { Art } from '../../../shared/art'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useForkViewModel } from '../viewmodel/useForkViewModel'

/** 목업 fork(id): U09 포크 (3단계 폼) */
export function ForkPage() {
  const { id = '' } = useParams()
  const [q] = useSearchParams()
  const vm = useForkViewModel(id, Number(q.get('at')))
  const d = vm.form
  if (d === undefined) return null
  if (d === null) return <Navigate replace to={`/work/${id}`} />
  if (d.existing) {
    return (
      <>
        <Gnb on="lib" />
        <main className="wrap"><div className="panel"><h1>이미 포크한 원작이에요</h1><p>한 원작에서 포크는 한 번만 만들 수 있어요.</p><Go to={`/studio/${d.existing.id}`} className="btn pri">내 포크 계속 쓰기</Go></div></main>
        <Footer />
      </>
    )
  }
  // 목업처럼 포크할 수 없는 원작은 상세 화면을 보여 줍니다.
  if (!d.forkList.length) return <Navigate replace to={`/work/${id}`} />
  const w = d.work
  return (
    <div className={`calm calm-${w.theme}`} style={{ minHeight: '100vh' }}>
      <div className="band" style={{ height: 300 }}><Art theme={w.theme} w={1200} h={300} seed={w.id + 'band'} /></div>
      <div className="wrap"><div className="topbar"><Go to={`/work/${id}`} className="back"><BackChev />{w.title}</Go><span style={{ marginLeft: 'auto' }} /></div></div>
      <div className="fork">
        <h1>「{w.title}」 포크</h1><p className="lead">고른 회차가 끝난 순간부터 나만의 소설이 시작돼요.</p>
        <section className="tcard fstep">
          <h3><i>1</i>어디서부터 바꿀까요?</h3>
          <div className="epc" id="epc">
            {vm.episodes.map(({ e, n, ok }) => (
              <button type="button" key={n} data-at={n} className={n === vm.at ? 'on' : ''} disabled={!ok} title={ok ? undefined : '작가가 포크를 허용하지 않은 회차'} onClick={() => vm.pick(n)}>{n}화 끝에서<small>{e.t}</small></button>
            ))}
          </div>
          <div className="carry" id="carry"><span>가져가는 것</span><span>공개된 세계관 규칙 <b id="rulecount">{vm.ruleCount}</b>개</span><span>공개된 인물 <b id="castcount">{vm.castCount}</b>명 (<b id="atl">{vm.at}</b>화 시점 상태)</span><span><b id="atl2">{vm.at}</b>화까지의 사건</span></div>
        </section>
        {d.historyConsentNeeded && <label className="field"><span><input type="checkbox" id="forkHistoryConsent" checked={vm.historyConsent} onChange={(e) => vm.setHistoryConsent(e.target.checked)} /> 회차별 설정 이력이 없어 현재 공개 설정이 포함되며 이후 회차 내용이 섞일 수 있음을 확인했어요.</span></label>}
        <section className="tcard fstep"><h3><i>2</i>무엇이 달라지나요?</h3><input className="tinp" id="fdir" value={vm.dir} onChange={(e) => vm.setDir(e.target.value)} placeholder="한 줄로 적어 주세요" maxLength={60} aria-label="무엇이 달라지나요?" /></section>
        <section className="tcard fstep"><h3><i>3</i>제목</h3><input className="tinp" id="ftit" value={vm.title} onChange={(e) => vm.setTitle(e.target.value)} maxLength={40} aria-label="제목" /></section>
        <p className="bm">포크 생성과 직접 쓰기는 무료예요. AI 도움의 과금 기준은 아직 정해지지 않았어요. 원작 링크가 함께 표시되고, 현금 수익 배분은 없어요.</p>
        <button type="button" className="tbtn pri" style={{ width: '100%', height: 56, fontSize: 16 }} id="startFork" onClick={vm.start}>포크 소설 시작하기 →</button>
      </div>
    </div>
  )
}
