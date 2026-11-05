import { useEffect, useRef, useState } from 'react'

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

type Field = { name: string; label: string; req?: boolean; opts?: [string, string][]; value?: string; checks?: string[] }

/** 목업 formSheet(title, fields, onOk): 사전·보드의 짧은 입력 시트. 필수 항목이 비면 토스트만 띄웁니다. */
export function FormSheet({ title, fields, onOk, onClose, ok = '추가' }: { title: string; fields: Field[]; onOk: (o: Record<string, string>, fd: FormData) => void; onClose: () => void; ok?: string }) {
  return (
    <Sheet sid="U38" label={title} onClose={onClose}>
      <div className="sh-h"><h3>{title}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <form id="fsf" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const o = Object.fromEntries(fields.map((f) => [f.name, String(fd.get(f.name) ?? '').trim()]))
        if (fields.some((f) => f.req && !o[f.name])) return toast('필수 항목을 입력해 주세요')
        onClose()
        onOk(o, fd)
      }}>
        {fields.map((f, i) => f.checks ? <div className="field" key={f.name}>{f.label}<div className="pick2">{f.checks.map((c) => <label className="ckp" key={c}><input type="checkbox" name={f.name} value={c} /> {c}</label>)}</div></div> : <label className="field" key={f.name}>{f.label}{f.opts
          ? <select className="inp" name={f.name} defaultValue={f.value} data-autofocus={i === 0 || undefined}>{f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : <input className="inp" name={f.name} defaultValue={f.value} maxLength={40} required={f.req} data-autofocus={i === 0 || undefined} />}</label>)}
        <div className="rowend"><button className="btn" type="button" onClick={onClose}>취소</button><button className="btn pri" type="submit">{ok}</button></div>
      </form>
    </Sheet>
  )
}
