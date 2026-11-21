import { useId } from 'react'
import type { CardType } from '../../../../domain/entities/studioCards'
import { RANGES, type GraphSettings } from '../viewmodel/graphForces'

/** 설정 패널의 필터 칸에 편집기가 넘기는 것: 설정 찾기(입력과 선택지)와 유형 체크박스(보이는 유형이 그것 하나뿐이면 `locked`). 상태는 편집기가 쥔다. */
export type Filters = {
  typed: string
  onTyped: (value: string) => void
  choices: readonly { id: string; name: string }[]
  types: readonly { id: CardType; label: string; count: number; locked: boolean }[]
  hidden: ReadonlySet<CardType>
  onToggleType: (id: CardType) => void
}
type Change = <K extends keyof GraphSettings>(key: K, value: GraphSettings[K]) => void

function Slider({ name, label, settings, onChange }: { name: keyof typeof RANGES; label: string; settings: GraphSettings; onChange: Change }) {
  const id = useId(), [min, max, step] = RANGES[name]
  return (
    <div className="relationship-slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={settings[name]} onChange={(e) => onChange(name, Number(e.target.value))} />
      <span aria-hidden="true">{settings[name]}</span>
    </div>
  )
}

/**
 * 관계도 그래프의 설정 패널(옵시디언 그래프 뷰의 톱니): 필터(설정 찾기·유형·외톨이 표시), 표시(화살표·텍스트 표시 임계값·노드 크기·선 두께), 힘(중심력·반발력·연결 힘·연결 거리)과 화면 맞춤·배치 정돈이다.
 * 값은 화면 상태일 뿐 저장하지 않는다. 힘 슬라이더를 움직이면 캔버스가 시뮬레이션을 다시 데운다. 열린 동안에도 초점은 톱니에 두고(비모달), Esc는 닫는다.
 */
export function GraphSettingsPanel({ id, settings, onChange, filters, onFit, onRelayout, onClose }: { id: string; settings: GraphSettings; onChange: Change; filters: Filters; onFit: () => void; onRelayout: () => void; onClose: () => void }) {
  const list = useId()
  return (
    <div id={id} className="relationship-settings" role="group" aria-label="그래프 설정" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="relationship-settings-actions">
        <button type="button" className="btn sm" onClick={onFit}>화면 맞춤</button>
        <button type="button" className="btn sm" onClick={onRelayout}>배치 정돈</button>
      </div>
      <section>
        <h4>필터</h4>
        <label className="relationship-find">
          설정 찾기
          <input type="search" role="combobox" list={list} className="inp" autoComplete="off" value={filters.typed} placeholder="설정 이름으로 찾기" onChange={(e) => filters.onTyped(e.target.value)} />
        </label>
        <datalist id={list}>{filters.choices.map((choice) => <option key={choice.id} value={choice.name} />)}</datalist>
        {filters.types.length > 0 && (
          <fieldset>
            <legend>유형</legend>
            {filters.types.map(({ id: type, label, count, locked }) => (
              <label key={type}><input type="checkbox" checked={!filters.hidden.has(type)} disabled={locked} onChange={() => filters.onToggleType(type)} /> {label} {count}</label>
            ))}
          </fieldset>
        )}
        <label><input type="checkbox" checked={settings.orphans} onChange={(e) => onChange('orphans', e.target.checked)} /> 외톨이 표시</label>
      </section>
      <section>
        <h4>표시</h4>
        <label><input type="checkbox" checked={settings.arrows} onChange={(e) => onChange('arrows', e.target.checked)} /> 화살표</label>
        <Slider name="textThreshold" label="텍스트 표시 임계값" settings={settings} onChange={onChange} />
        <Slider name="nodeSize" label="노드 크기" settings={settings} onChange={onChange} />
        <Slider name="linkWidth" label="선 두께" settings={settings} onChange={onChange} />
      </section>
      <section>
        <h4>힘</h4>
        <Slider name="center" label="중심력" settings={settings} onChange={onChange} />
        <Slider name="repel" label="반발력" settings={settings} onChange={onChange} />
        <Slider name="linkForce" label="연결 힘" settings={settings} onChange={onChange} />
        <Slider name="linkDistance" label="연결 거리" settings={settings} onChange={onChange} />
      </section>
    </div>
  )
}
