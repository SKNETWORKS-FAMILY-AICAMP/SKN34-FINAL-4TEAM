import { IMPORT } from '../../../../domain/usecases/LibraryUseCase'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useImportViewModel } from '../viewmodel/useImportViewModel'

const STEPS = [['글 다듬기', '특수문자·빈칸 정리'], ['회차 나누기', '장 → 회차 4화'], ['인물·관계 찾기', '인물 5 · 관계 6'], ['세계관·사건 찾기', '규칙 2 · 사건 4'], ['내가 확인하기', '틀린 건 고치고 저장']]

/** 목업 importer(): U24 소설 가져오기 */
export function ImportPage() {
  const vm = useImportViewModel()
  const { step, done } = vm
  const json = JSON.stringify({
    title: '춘향전', source: vm.kind,
    world: { era: '조선 숙종 대', places: ['남원 광한루', '오작교', '한양'], rules: vm.result.world.filter((x) => x.startsWith('규칙')).map((x) => x.slice(4)) },
    characters: vm.result.cast.map((c, i) => ({ name: c.split(' · ')[0], role: c.split(' · ')[1], first_ep: i < 2 ? 1 : i === 2 ? 3 : 1 })),
    events: vm.result.events.map((e) => ({ ep: +e[0], summary: e.slice(3) })), episodes: 4,
  }, null, 2)
  return (
    <>
      <Gnb on="lib" />
      <main className="wrap">
        <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go><h2 style={{ fontSize: 21, fontWeight: 800 }}>내 소설 가져오기</h2><span className="demo">가상 추출</span></div>
        <div className="imp">
          <div className="panel"><b>1. 소설 올리기</b>
            <p className="small muted">가져오기 대상: TXT 또는 DRM이 없는 EPUB. 원고 이미지도 보존 대상이에요. 파일 크기·수 제한은 미정이며 이 화면은 실제 파일을 업로드하지 않아요.</p>
            <button type="button" className="drop" style={{ marginTop: 10 }} onClick={vm.pick}>예시 소설 선택 · 실제 파일 업로드는 연결되지 않은 데모{vm.picked ? <b>✓ {IMPORT.file} · {IMPORT.size}</b> : <b style={{ color: 'var(--faint)' }}>눌러서 예시 소설 선택</b>}</button>
            <label className="field">연결할 내 세계관<select className="inp" id="importWorld" value={vm.world} onChange={(e) => vm.setWorld(e.target.value)}><option value="">세계관을 선택해 주세요</option>{vm.myWorlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <Go to="/new" className="btn sm">새 소설 만들기에서 세계관 만들기</Go>
            <div className="field" style={{ marginTop: 12 }}>어떤 소설인가요?<div className="seg" id="ikind">{['자체 창작', '다른 사람 소설'].map((x) => <button type="button" key={x} className={vm.kind === x ? 'on' : ''} aria-pressed={vm.kind === x} onClick={() => vm.setKind(x)}>{x}</button>)}</div></div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 10 }}><input type="checkbox" id="iok" checked={vm.ok} onChange={(e) => vm.setOk(e.target.checked)} /> 이 소설을 AI로 처리할 권리가 있어요</label>
            <div style={{ marginTop: 16 }}><b>2. AI가 정리하는 단계</b><div>{STEPS.map((s, i) => {
              const fin = step > i || (done && i < 4)
              return <div key={i} className={`pp ${fin ? 'done' : step === i ? 'run' : ''}`}><i>{fin ? '✓' : i + 1}</i><div><b>{s[0]}</b><span>{s[1]}</span></div>{done && i < 4 ? <span className="chip ok">완료</span> : i === 4 && done ? <span className="chip wait">내 차례</span> : null}</div>
            })}</div></div>
            {!done && <button type="button" className="btn pri" style={{ width: '100%', marginTop: 10 }} disabled={vm.running || !vm.picked} onClick={vm.start}>{vm.running ? '정리 중…' : '정리 시작'}</button>}
          </div>
          <div className="panel"><b>3. 정리된 결과를 확인하세요</b><p className="small muted" style={{ margin: '4px 0 12px' }}>항목을 눌러 바로 고칠 수 있어요. 저장해야 세계관·인물에 들어가요.</p>
            {done ? (
              <>
                <div className="res3">{([['인물', 'cast'], ['세계관', 'world'], ['사건', 'events']] as const).map(([h, k]) => (
                  <div className="rc" key={h}><h4>{h} <span className="muted">{vm.result[k].length}</span></h4><ul>{vm.result[k].map((c, i) => <li key={i + c} contentEditable suppressContentEditableWarning onBlur={(e) => vm.edit(k, i, e.currentTarget.innerText ?? e.currentTarget.textContent ?? '')}>{c}</li>)}</ul></div>
                ))}</div>
                <div className="json" id="json">{json}</div>
                <div className="rowend" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={vm.rerun}>다시 정리 <span className="demo">예시 10 · 미확정</span></button><button type="button" className="btn pri" id="saveimp" onClick={vm.save}>확인하고 저장</button></div>
              </>
            ) : <div className="drop" style={{ cursor: 'default' }}>정리를 시작하면 여기에 인물 · 세계관 · 사건 3영역과 JSON이 나와요</div>}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
