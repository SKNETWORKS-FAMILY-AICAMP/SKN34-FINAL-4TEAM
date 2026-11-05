import { useEffect, useRef } from 'react'
import type { PlanInput } from '../../../../domain/entities/storyPlan'
import type { StoryPlanUseCase } from '../../../../domain/usecases/StoryPlanUseCase'
import { Sheet } from '../../../shared/Sheet'
import { useStoryPlanViewModel } from '../viewmodel/useStoryPlanViewModel'
import { deletionFocusOrder } from './deletionFocus'
import './plans.css'

export function StoryPlanWorkspace({ workId, demo = false, api }: { workId: string; demo?: boolean; api?: StoryPlanUseCase }) {
  const vm = useStoryPlanViewModel(workId, demo, api)
  const plots = vm.plans.filter(p => p.kind === 'plot')
  const scenes = vm.plans.filter(p => p.kind === 'scene' && p.parentId === vm.selected?.id)
  const planButtons = useRef(new Map<string, HTMLButtonElement>())
  const addPlot = useRef<HTMLButtonElement>(null)
  const addScene = useRef<HTMLButtonElement>(null)
  const deletionFocus = useRef<{ workId: string; id: string; kind: 'plot' | 'scene'; order: string[] } | null>(null)

  useEffect(() => {
    if (deletionFocus.current?.workId !== workId) deletionFocus.current = null
    if (vm.deleting) {
      if (!deletionFocus.current) deletionFocus.current = { workId, id: vm.deleting.id, kind: vm.deleting.kind, order: deletionFocusOrder(vm.plans, vm.deleting) }
      return
    }
    if (vm.busy) return
    const previous = deletionFocus.current
    deletionFocus.current = null
    if (!previous || vm.plans.some(plan => plan.id === previous.id)) return
    // Sheet의 닫힘 정리가 끝난 뒤, 포커스가 사라진 삭제 동작만 복구한다.
    if (document.querySelector('[role="dialog"]') || document.activeElement !== document.body) return
    const next = previous.order.map(id => planButtons.current.get(id)).find(button => button?.isConnected && !button.disabled)
    const fallback = previous.kind === 'scene' ? addScene.current ?? addPlot.current : addPlot.current
    ;(next ?? fallback)?.focus()
  }, [workId, vm.deleting, vm.busy, vm.plans])

  const refs = vm.references
  const names = (ids: string[], options: { id: string; name: string }[]) => ids.map(id => options.find(o => o.id === id)?.name ?? '연결 확인 필요').join(' · ')
  const value = vm.editor?.value
  const options = (field: 'characterIds' | 'placeIds', label: string, items: { id: string; name: string }[]) => {
    if (!value) return null
    const unavailable = value[field].filter(id => !items.some(o => o.id === id))
    const toggle = (id: string) => vm.change({ [field]: value[field].includes(id) ? value[field].filter(x => x !== id) : [...value[field], id] })
    return <fieldset className="plan-options"><legend>{label}</legend>
      {!items.length && <p className="small muted">선택할 {label} 항목이 없어요. 기존 사전에 확정된 항목이 표시돼요.</p>}
      {items.map(item => <label key={item.id}><input type="checkbox" checked={value[field].includes(item.id)} disabled={!value[field].includes(item.id) && value[field].length >= 30} onChange={() => toggle(item.id)} />{item.name}</label>)}
      {unavailable.map(id => <label key={id}><input type="checkbox" checked onChange={() => toggle(id)} />조회할 수 없는 연결 · 선택 해제 후 저장해 주세요</label>)}
    </fieldset>
  }
  const update = (patch: Partial<PlanInput>) => vm.change(patch)
  return <section className="plan-workspace" aria-busy={vm.busy}>
    <div className="plan-heading"><div><h2>플롯</h2><p className="muted">플롯과 장면을 계획하세요. 저장해도 원고·사전에는 자동 반영되지 않아요.</p></div><span className="chip">비공개 계획</span></div>
    {demo && <p className="note2">메모리 데모예요. 새로고침하면 계획이 초기화되고 서버에는 저장되지 않아요.</p>}
    <div className="plan-feedback" aria-live="polite">{!vm.ready ? <p role="status">계획과 참조 목록을 불러오고 있어요…</p> : vm.busy ? <p role="status">처리 중…</p> : vm.notice && !vm.deleting ? <p role="status">{vm.notice}</p> : <p className="muted">{vm.dirty ? '저장하지 않은 변경이 있어요.' : '계획은 저장 버튼을 눌러 보관해요.'}</p>}</div>
    {vm.error && !vm.editor && !vm.deleting && <div className="plan-error" role="alert"><p>{vm.error}</p><button type="button" className="btn sm" disabled={vm.busy} onClick={vm.reload}>다시 불러오기</button></div>}
    <div className="plan-layout">
      <nav className="plan-list" aria-label="플롯 목록">
        <div className="plan-section-head"><h3>내 플롯</h3><button ref={addPlot} type="button" className="btn sm pri" disabled={vm.busy || !refs} onClick={() => vm.create(null)}>플롯 추가</button></div>
        {vm.ready && !plots.length && refs && <p className="muted plan-empty">아직 플롯이 없어요.<br />이야기의 흐름부터 적어 보세요.</p>}
        {plots.map(plot => <button type="button" key={plot.id} ref={button => { if (button) planButtons.current.set(plot.id, button); else planButtons.current.delete(plot.id) }} className={`plan-list-item${vm.selected?.id === plot.id ? ' on' : ''}`} aria-current={vm.selected?.id === plot.id ? 'true' : undefined} disabled={vm.busy} onClick={() => vm.select(plot.id)}><strong>{plot.title}</strong><small>장면 계획 {vm.plans.filter(p => p.parentId === plot.id).length}개</small></button>)}
      </nav>
      <div className="plan-detail">
        {vm.selected ? <>
          <div className="plan-section-head"><h3>{vm.selected.title}</h3><div className="plan-actions"><button type="button" className="btn sm" disabled={vm.busy} onClick={() => vm.edit(vm.selected!)}>플롯 수정</button><button type="button" className="btn sm" disabled={vm.busy} onClick={() => vm.askDelete(vm.selected!)}>플롯 삭제</button></div></div>
          <p className={`plan-content${vm.selected.content ? '' : ' muted'}`}>{vm.selected.content || '아직 플롯 내용이 없어요. 수정에서 내용을 적어 보세요.'}</p>
          <div className="plan-section-head plan-scenes-head"><h3>장면 계획</h3><button ref={addScene} type="button" className="btn sm pri" disabled={vm.busy || !refs} onClick={() => vm.create(vm.selected!.id)}>장면 계획 추가</button></div>
          {!scenes.length && <p className="plan-empty muted">이 플롯의 첫 장면을 계획해 보세요.</p>}
          <ol className="plan-scenes">{scenes.map(scene => <li key={scene.id}>
            <button type="button" ref={button => { if (button) planButtons.current.set(scene.id, button); else planButtons.current.delete(scene.id) }} className="plan-scene-open" disabled={vm.busy} onClick={() => vm.edit(scene)}>
              <small>{scene.episodeMissing ? '연결 회차 확인 필요' : scene.episodeNumber ? `${scene.episodeNumber}화 계획` : '회차 미정'}</small><strong>{scene.title}</strong><span>{scene.content || '아직 장면 내용이 없어요.'}</span>
              {refs && <small>{names(scene.characterIds, refs.characters) || '등장인물 미정'}{scene.placeIds.length ? ` / ${names(scene.placeIds, refs.places)}` : ''}</small>}
            </button><button type="button" className="btn sm" aria-label="장면 계획 삭제" disabled={vm.busy} onClick={() => vm.askDelete(scene)}>삭제</button>
          </li>)}</ol>
        </> : <p className="plan-empty muted">플롯을 추가하거나 목록에서 선택하면 상세 내용과 장면 계획을 볼 수 있어요.</p>}
      </div>
    </div>
    {vm.editor && value && <Sheet sid="U40" label={`${value.kind === 'plot' ? '플롯' : '장면 계획'} ${vm.editor.previous ? '수정' : '추가'}`} panelClass="sheet plan-sheet" onClose={vm.closeEditor}>
      <form className="plan-form" onSubmit={event => { event.preventDefault(); vm.save() }}>
        <h2>{value.kind === 'plot' ? '플롯' : '장면 계획'} {vm.editor.previous ? '수정' : '추가'}</h2>
        <p className="small muted">비공개 계획이에요. 저장해도 원고·확정 사건·인물 상태는 바뀌지 않아요.</p>
        {vm.error && <div className="plan-error" role="alert" id="plan-form-error"><p>{vm.error}</p><button type="button" className="btn sm" disabled={vm.busy} onClick={vm.reload}>최신 내용 다시 불러오기</button></div>}
        <fieldset disabled={vm.busy} className="plan-fields" aria-describedby={vm.error ? 'plan-form-error' : undefined}>
          <label className="field">{value.kind === 'plot' ? '플롯 제목' : '장면 제목'}<input className="inp" data-autofocus required maxLength={120} value={value.title} onChange={e => update({ title: e.target.value })} /></label>
          <label className="field">계획 내용<textarea className="ta" aria-label="계획 내용" aria-describedby="plan-content-count" maxLength={8000} rows={7} value={value.content} onChange={e => update({ content: e.target.value })} /><span id="plan-content-count" className="small muted plan-count">{value.content.length.toLocaleString('ko-KR')} / 8,000자</span></label>
          {value.kind === 'scene' && refs && <>
            <label className="field">연결 회차<select className="inp" value={value.episodeNumber ?? ''} onChange={e => update({ episodeNumber: e.target.value ? Number(e.target.value) : null })}><option value="">회차 미정</option>{refs.episodes.map(e => <option key={e.number} value={e.number}>{e.number}화 · {e.title}</option>)}{value.episodeNumber && !refs.episodes.some(e => e.number === value.episodeNumber) && <option value={value.episodeNumber}>연결 회차 없음 · 연결 해제 필요</option>}</select></label>
            {vm.editor.previous?.episodeMissing && <p className="small plan-error">이전에 연결한 회차가 없어요. 회차 미정으로 저장한 뒤 필요한 회차를 다시 선택해 주세요.</p>}
            {options('characterIds', '등장인물', refs.characters)}{options('placeIds', '장소', refs.places)}
          </>}
        </fieldset>
        <div className="plan-form-actions"><span className="small muted" role="status">{vm.busy ? '저장 중…' : vm.dirty ? '저장하지 않은 변경' : '내용을 확인해 주세요.'}</span><button type="button" className="btn" disabled={vm.busy} onClick={vm.closeEditor}>취소</button><button type="submit" className="btn pri" disabled={vm.busy || !value.title.trim()}>저장</button></div>
      </form>
    </Sheet>}
    {vm.deleting && <Sheet sid="U40" label="계획 삭제 확인" panelClass="sheet plan-sheet" onClose={vm.closeDelete}>
      <div className="plan-form">
        <h2>계획을 삭제할까요?</h2>
        <p className="plan-content">{vm.deleting.title}</p>
        <p className="plan-content">{vm.deleting.content || '아직 계획 내용이 없어요.'}</p>
        <p className="muted">목록에서 제외돼요. 연결된 회차·원고·사전은 삭제하지 않아요. 하위 장면 계획이 남은 플롯은 삭제할 수 없어요.</p>
        {vm.error && <div className="plan-error" role="alert">{vm.error}</div>}
        {vm.deleteNeedsReview && <p className="small muted">목록이 바뀌었을 수 있어요. 최신 목록을 확인한 뒤 삭제해 주세요.</p>}
        {vm.notice && <p role="status">{vm.notice}</p>}
        <div className="plan-form-actions">
          <button type="button" className="btn" disabled={vm.busy} onClick={vm.reviewDelete}>최신 목록 확인</button>
          <button type="button" className="btn" disabled={vm.busy} onClick={vm.closeDelete}>취소</button>
          <button type="button" className="btn danger" disabled={vm.busy || vm.deleteNeedsReview} onClick={vm.remove}>삭제</button>
        </div>
      </div>
    </Sheet>}
  </section>
}
