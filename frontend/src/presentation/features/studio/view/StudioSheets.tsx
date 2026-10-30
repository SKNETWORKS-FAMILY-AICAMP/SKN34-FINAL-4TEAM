import { useEffect, useRef, useState } from 'react'

import type { Work } from '../../../../domain/entities/work'
import type { PublishSettings } from '../../../../domain/usecases/StudioUseCase'
import { toast } from '../../../shared/events'
import { Portrait } from '../../../shared/Portrait'
import { hasPortrait } from '../../../shared/portraitSvg'
import { Sheet } from '../../../shared/Sheet'
import type { useStudioViewModel } from '../viewmodel/useStudioViewModel'

type VM = ReturnType<typeof useStudioViewModel>

/** 목업 simSheet(id): U15 인물에게 맡겨 보기. 고정 예시 대화를 한 턴씩 보여 줍니다 (실제 AI 호출 없음). */
export function SimSheet({ vm, onClose }: { vm: VM; onClose: () => void }) {
  const s = vm.studio!, w = s.work, cast = s.base.cast
  const [situation, setSituation] = useState(w.parent === 'guunmong' ? '다음 날 아침, 팔선녀가 다시 연화봉을 찾아온다.' : '두 인물이 처음으로 같은 장소에서 마주친다.')
  const [keep, setKeep] = useState(w.parent === 'guunmong' ? '성진은 계율을 직접 어기지 않는다' : '')
  const [picked, setPicked] = useState(() => cast.slice(0, 3).map((c) => c.n))
  const [turns, setTurns] = useState<[string, string][]>([])
  const [k, setK] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const running = turns.length > 0 && k < turns.length
  const done = turns.length > 0 && k >= turns.length
  const chosen = cast.filter((c) => picked.includes(c.n))
  const col = (n: string) => (cast.find((c) => c.n === n) ?? { c: '#888' }).c
  const run = async () => {
    if (picked.length < 2) return toast('인물을 2명 이상 골라 주세요')
    if (!await vm.runSim()) return
    const t = vm.simTurns(picked)
    setTurns(t)
    const step = (n: number) => { setK(n); if (n < t.length) timer.current = window.setTimeout(() => step(n + 1), 550) }
    step(1)
  }
  return (
    <Sheet sid="U15" label="인물에게 맡겨 보기" dimClass="back-dim bottom" panelClass="sheet wide" onClose={onClose}>
      <div className="grab" />
      <div className="sh-h"><h3>🎭 인물에게 맡겨 보기</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="simg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">어떤 상황인가요?<textarea className="ta" id="simq" style={{ minHeight: 80 }} value={situation} onChange={(e) => setSituation(e.target.value)} /></label>
          <div className="field">누가 등장하나요? (이 소설의 스냅샷 인물)<div className="pick2" id="pick">{cast.map((c) => (
            <button type="button" key={c.n} className={picked.includes(c.n) ? 'on' : ''} aria-pressed={picked.includes(c.n)} disabled={turns.length > 0}
              onClick={() => setPicked(picked.includes(c.n) ? picked.filter((x) => x !== c.n) : [...picked, c.n])}>{c.n} · {c.st}</button>
          ))}</div></div>
          <label className="field">꼭 지킬 것 (선택)<input className="inp" id="simc" value={keep} onChange={(e) => setKeep(e.target.value)} /></label>
          <button type="button" className="btn pri" id="run" disabled={turns.length > 0} onClick={run}>{done ? '✓ 완료' : running ? '진행 중…' : '▶ 실행하기'}</button><span className="note2" style={{ color: 'var(--sub)' }}>예상 크레딧: 예시 30 (미확정 · 차감 없음)</span>
        </div>
        <div><b style={{ fontSize: 14 }}>인물들의 대화</b>
          {k ? turns.slice(0, k).map((t, i) => <div className="turn" key={i}><span className="av pt" style={{ background: col(t[0]) }}>{hasPortrait(t[0]) ? <Portrait name={t[0]} size={36} /> : t[0].slice(0, 1)}</span><div><b>{t[0]}<small>{i + 1}턴</small></b><br /><p>{t[1]}</p></div></div>)
            : <p className="muted small" style={{ marginTop: 12 }}>왼쪽에서 상황을 정하고 실행해 보세요.</p>}
          {done && chosen.length > 1 && <>
            <div className="sum3"><div><small>인물 변화 (제안)</small>{chosen[0].n}: {chosen[0].st} → 결심</div><div><small>관계 변화 (제안)</small>{chosen[0].n}–{chosen[1].n} 신뢰 ↑</div><div><small>설정 검사</small>어긋난 곳 없음</div></div>
            <div className="note" style={{ marginTop: 10 }}>가져와도 소설·설정은 자동으로 바뀌지 않아요. 집필실에서 참고 자료로 쓰여요.</div>
            <div className="rowend" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>버리기</button><button type="button" className="btn pri" id="takeSim" onClick={async () => { await vm.takeSim(situation, picked, turns.length); onClose() }}>집필실로 가져오기</button></div>
          </>}
        </div>
      </div>
    </Sheet>
  )
}

/** 목업 publishSheet(id): U21 소설 공개 설정. 집필실과 서재 양쪽에서 엽니다. */
export function PublishSettingsSheet({ work: w, onSave, onClose }: { work: Work; onSave: (st: PublishSettings) => Promise<boolean>; onClose: () => void }) {
  const [st, setSt] = useState<PublishSettings>({ vis: w.private ? '나만' : '모두', on: !!w.forksAllowed, all: !!w.forkAll, eps: w.forkEps ?? [], kind: w.kind, ok: w.rights === '확인됨' })
  const set = (patch: Partial<PublishSettings>) => setSt({ ...st, ...patch })
  const mode = !st.on ? 'off' : st.all ? 'all' : 'eps'
  const all = w.eps.map((_, i) => i + 1)
  return (
    <Sheet sid="U21" label={`공개 설정 · ${w.title}`} onClose={onClose}>
      <div className="sh-h"><h3>공개 설정 · {w.title}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <div className="field">누가 읽을 수 있나요?<div className="seg">{(['나만', '모두'] as const).map((x) => <button type="button" key={x} className={st.vis === x ? 'on' : ''} aria-pressed={st.vis === x} onClick={() => set({ vis: x })}>{x}</button>)}</div></div>
      <div className="field">다른 사람의 포크<div className="seg">{([['off', '허용 안 함'], ['eps', '회차별 선택'], ['all', '전체 회차 허용']] as const).map(([m, l]) => (
        <button type="button" key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => set({ on: m !== 'off', all: m === 'all', eps: m === 'eps' && !st.eps.length ? all : st.eps })}>{l}</button>
      ))}</div></div>
      {st.on && !st.all && <div className="fkeps" id="fkeps">{w.eps.length ? w.eps.map((e, i) => (
        <label className="fke" key={i}><input type="checkbox" checked={st.eps.includes(i + 1)} onChange={(x) => set({ eps: x.target.checked ? [...st.eps, i + 1] : st.eps.filter((n) => n !== i + 1) })} /><span><b>{i + 1}화</b> {e.t}</span><small>{st.eps.includes(i + 1) ? '포크 허용' : '허용 안 함'}</small></label>
      )) : <p className="note2">아직 공개한 회차가 없어요.</p>}
        <div className="rowend" style={{ justifyContent: 'flex-start', marginTop: 6 }}><button type="button" className="btn sm" onClick={() => set({ eps: all })}>모두 선택</button><button type="button" className="btn sm" onClick={() => set({ eps: [] })}>모두 해제</button></div></div>}
      {st.on && st.all && <p className="note2" style={{ marginTop: -4 }}>지금 있는 회차와 앞으로 공개할 회차 모두 포크할 수 있어요.</p>}
      <div className="field">어떤 소설인가요?<div className="seg">{['자체 창작', '다른 사람 소설'].map((x) => <button type="button" key={x} className={st.kind === x ? 'on' : ''} aria-pressed={st.kind === x} onClick={() => set({ kind: x })}>{x}</button>)}</div></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><input type="checkbox" id="rok" checked={st.ok} onChange={(e) => set({ ok: e.target.checked })} /> 이 소설을 올리고 AI 처리·포크를 허용할 적법한 권리가 있어요</label>
      {st.kind === '다른 사람 소설' && <div className="policy">다른 사람 소설은 신고가 접수되면 운영팀이 공개·포크를 제한할 수 있어요 (관리자 화면 A03).</div>}
      <div className="policy">P2 · 미확정 정책 — 유료 열람, 판매 수익 배분은 아직 정해지지 않아 선택할 수 없어요.</div>
      <div className="rowend"><button type="button" className="btn" onClick={onClose}>취소</button><button type="button" className="btn pri" id="savepub" onClick={async () => { if (await onSave(st)) onClose() }}>저장</button></div>
    </Sheet>
  )
}
