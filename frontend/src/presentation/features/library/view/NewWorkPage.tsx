import { useState, type FormEvent } from 'react'

import { NOVEL_GENRES, NOVEL_TAG_GROUPS, type WorldForm, type WorldPermission } from '../../../../domain/usecases/LibraryUseCase'
import type { World } from '../../../../domain/entities/world'
import { Go } from '../../../shared/Go'
import { BackChev } from '../../../shared/icons'
import { resizeImg } from '../../../shared/resizeImg'
import { toast } from '../../../shared/events'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useNewWorkViewModel } from '../viewmodel/useNewWorkViewModel'

type VM = ReturnType<typeof useNewWorkViewModel>
const DAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']
const PERMS: [WorldPermission, string][] = [['allowUse', '이용'], ['allowFork', '세계관 포크'], ['allowAI', 'AI 처리'], ['allowPaid', '유료 공개']]
const rowLabel = { flexDirection: 'row', alignItems: 'flex-start', margin: '14px 0' } as const
const worldForm = (e: FormEvent<HTMLFormElement>): WorldForm => {
  const f = new FormData(e.currentTarget)
  return { name: String(f.get('name') ?? ''), description: String(f.get('description') ?? ''), rules: String(f.get('rules') ?? '') }
}

/** 목업 newWork(): U28 새 소설 만들기 */
export function NewWorkPage() {
  const vm = useNewWorkViewModel()
  return (
    <>
      <Gnb on="lib" />
      <main className="wrap">{vm.policyAccepted ? <NewWorkForm vm={vm} /> : <PolicyGate vm={vm} />}</main>
      <Footer />
    </>
  )
}

function PolicyGate({ vm }: { vm: VM }) {
  const [ack, setAck] = useState(false)
  return (
    <div className="fork">
      <Go to="/lib?tab=write" className="back">내가 쓰는 소설</Go>
      <h1 style={{ fontSize: 34, fontWeight: 800, margin: '14px 0 6px' }}>집필 전 정책 확인</h1>
      <p className="muted">작품 등록과 서비스 이용 범위를 먼저 확인해 주세요.</p>
      <section className="tcard fstep" style={{ marginTop: 18 }}>
        <h2>작품 등록과 권리</h2>
        <ul><li>작품을 등록·공개하거나 AI 처리·Fork에 이용하려면 해당 범위를 허락할 권리 또는 적법한 이용 근거가 필요합니다. 타인의 원문·이미지·설정을 허락 없이 등록하지 마세요.</li><li>작품 등록만으로 저작권이 STORYFORK에 이전되지는 않으며, 등록했다고 사전 권리 심사를 통과한 것도 아닙니다.</li><li>회사도 자체 제작·수집·학습·발행 행위에 필요한 권리를 별도로 확인합니다. 이용자에게 책임을 안내하더라도 회사의 책임까지 이용자에게 넘기지 않습니다.</li></ul>
        <h2 style={{ marginTop: 18 }}>AI 처리와 Fork</h2>
        <ul><li>원문 저장·설정 추출·검색·외부 AI 처리·공개·Fork는 작품별로 허용 범위와 조건을 확인합니다.</li><li>작품 등록이나 AI 기능 사용만으로 모델 학습, 상업적 이용, 무제한 재창작에 동의한 것으로 보지 않습니다.</li><li>Fork는 허용된 작품·회차와 고정된 기준 버전 안에서 이용하며, 원작의 후속 변경이 자동 반영되지 않습니다.</li></ul>
        <h2 style={{ marginTop: 18 }}>권리침해 요청과 조치</h2>
        <ul><li>요건을 갖춘 중단 요청이나 구체적인 침해 정황을 확인하면 관련 범위의 열람·검색·AI 생성·Fork를 제한하고, 게시자에게 소명 및 재개 절차를 안내합니다.</li><li>중단은 침해의 최종 확정이나 영구 삭제와 다릅니다. 연결된 모든 Fork를 일괄 삭제하지 않고 실제로 문제 내용을 포함하거나 승계한 범위를 살펴 조치합니다.</li></ul>
        <p className="note2" style={{ marginTop: 16 }}>AI 처리·공개·Fork 허용은 아래 확인만으로 자동 설정되지 않습니다. 작품별 설정에서 권리가 있는 범위만 선택해 주세요.</p>
      </section>
      <form id="workPolicyForm" onSubmit={(e) => { e.preventDefault(); vm.acceptPolicy(ack) }}>
        <label className="field" style={rowLabel}><input type="checkbox" id="workPolicyAck" required checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>운영 정책을 확인했고, 제가 설정하는 등록·공개·AI 처리·Fork 범위에 필요한 권리와 이용 근거를 확인하겠습니다.</span></label>
        <button className="btn pri" type="submit">정책 확인 후 작품 설정하기</button>
      </form>
    </div>
  )
}

function NewWorkForm({ vm }: { vm: VM }) {
  const { form: f, worlds } = vm
  const [tagInput, setTagInput] = useState('')
  const [tagPick, setTagPick] = useState('')
  const addTag = (v: string) => { if (vm.addTag(v)) { setTagInput(''); setTagPick('') } }
  return (
    <div className="fork newwork-page">
      <Go to="/lib?tab=write" className="back"><BackChev />내가 쓰는 소설</Go>
      <h1 style={{ fontSize: 34, fontWeight: 800, margin: '14px 0 6px' }}>새 소설 쓰기</h1>
      <p className="muted">세계관과 인물을 먼저 정해 두면, 집필실의 설정 검사와 인물 시뮬레이션이 이 정보를 써요.</p>
      {worlds && <WorldManager vm={vm} />}
      <div className="tcard fstep"><h3>연결할 세계관</h3><p className="small muted">1개 이상 5개 이하를 선택해 주세요.</p>
        {worlds?.linkable.length ? worlds.linkable.map((w) => (
          <label className="field" key={w.id}><span><input type="checkbox" name="world" value={w.id} checked={f.worldIds.includes(w.id)} onChange={(e) => vm.toggleWorld(w.id, e.target.checked)} /> {w.name} · {w.owner ? '공개 이용' : w.public ? '내 공개 세계관' : '내 비공개 세계관'}</span></label>
        )) : <p className="note2">먼저 세계관을 만들어 주세요.</p>}
      </div>
      <div className="tcard fstep"><h3><i>1</i>소설 정보</h3><div className="newwork-info-grid">
        <label className="field">제목<input className="inp" id="nwt" value={f.title} onChange={(e) => vm.set({ title: e.target.value })} maxLength={40} placeholder="예: 안개 항구의 등대지기" /></label>
        <label className="field">장르<select className="inp" id="nwg" value={f.genre} onChange={(e) => vm.set({ genre: e.target.value })}>{NOVEL_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        <fieldset className="novel-days" id="nwschedule"><legend>연재 요일</legend><p className="small muted" style={{ margin: '0 0 8px' }}>요일은 여러 개 선택할 수 있어요.</p><div className="novel-choices">
          {[...DAYS, '비정기'].map((day) => (
            <label className="novel-choice" key={day}><input type="checkbox" name={day === '비정기' ? undefined : 'novelDay'} id={day === '비정기' ? 'nwIrregular' : undefined} value={day} checked={f.schedule.includes(day)}
              onChange={(e) => vm.set({ schedule: [...DAYS, '비정기'].filter((d) => d === day ? e.target.checked : f.schedule.includes(d)) })} />{day}</label>
          ))}
        </div></fieldset>
        <label className="field">연령 제한<select className="inp" id="nwRating" value={f.rating} onChange={(e) => vm.set({ rating: e.target.value })}><option value="일반">일반</option><option value="성인">성인 (19세 이상)</option></select></label>
        <label className="field newwork-wide">한 줄 소개<input className="inp" id="nws" value={f.summary} onChange={(e) => vm.set({ summary: e.target.value })} maxLength={80} placeholder="예: 매일 밤 꺼지는 등대, 그 이유를 아는 사람은 한 명뿐이다" /></label>
        <div className="field newwork-wide" id="nwTags"><span>해시태그 <span className="muted">· 최소 2개</span></span><span className="small muted" id="nwTagCount" aria-live="polite">{f.tags.length}개 선택 · 최소 2개</span>
          <div className="novel-tag-actions"><label className="field" htmlFor="nwTagInput">직접 입력<input className="inp" id="nwTagInput" autoComplete="off" placeholder="태그를 입력하고 Enter를 누르세요" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addTag(tagInput) } }} /></label><button className="btn sm" type="button" id="nwTagAdd" onClick={() => addTag(tagInput)}>직접 추가</button></div>
          <div className="novel-tag-actions" style={{ marginTop: 10 }}><label className="field" htmlFor="nwTagSelect">추천 태그<select className="inp" id="nwTagSelect" value={tagPick} onChange={(e) => setTagPick(e.target.value)}><option value="">추천 태그를 선택해 주세요</option>{Object.entries(NOVEL_TAG_GROUPS).map(([group, tags]) => <optgroup key={group} label={group}>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>)}</select></label><button className="btn sm" type="button" id="nwTagSelectAdd" onClick={() => tagPick ? addTag(tagPick) : toast('추천 태그를 선택해 주세요')}>선택 추가</button></div>
          <div className="novel-tag-chips" id="nwTagChips" aria-live="polite">{f.tags.length ? f.tags.map((tag) => (
            <span className="novel-tag-chip" key={tag}><span>#{tag}</span><button type="button" aria-label={`${tag} 태그 삭제`} onClick={() => vm.removeTag(tag)}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></span>
          )) : <span className="small muted">추가한 태그가 여기에 표시돼요.</span>}</div>
        </div>
        <div className="field newwork-wide">표지 이미지 <span className="muted small">(선택 · jpg·png)</span><div className="nwcov"><div className="pv" id="nwcovpv">{f.cover ? <img className="cimg" src={f.cover} alt="표지 미리보기" /> : <span>3:4 비율 추천</span>}</div>
          <label className="btn sm">이미지 고르기<input type="file" accept="image/*" hidden id="nwcov" onChange={(e) => resizeImg(e.target.files?.[0], (url) => { vm.set({ cover: url }); toast('표지 이미지를 넣었어요') })} /></label></div></div>
      </div></div>
      <div className="tcard fstep"><h3><i>2</i>세계관 규칙</h3><label className="field">한 줄에 하나씩 적어 주세요 (설정 검사에 쓰여요)<textarea className="ta" id="nwr" placeholder="예: 해가 지면 항구의 문은 닫힌다" value={f.localRules} onChange={(e) => vm.set({ localRules: e.target.value })} /></label></div>
      <div className="tcard fstep"><h3><i>3</i>인물</h3><p className="note2" style={{ margin: '-4px 0 10px' }}>2명 이상이면 ‘인물에게 맡겨 보기’를 쓸 수 있어요.</p>
        {f.cast.map((c, i) => (
          <div className="nwc" key={i}><input className="inp" data-cn={i} value={c.n} onChange={(e) => vm.setCast(i, 'n', e.target.value)} placeholder={`이름${i < 1 ? ' (필수)' : ''}`} maxLength={12} aria-label={`인물 ${i + 1} 이름`} /><input className="inp" data-cd={i} value={c.d} onChange={(e) => vm.setCast(i, 'd', e.target.value)} placeholder="한 줄 설명 (예: 등대지기 노인)" maxLength={30} aria-label={`인물 ${i + 1} 설명`} /></div>
        ))}
      </div>
      <div className="tcard fstep"><h3><i>4</i>다른 사람의 포크</h3><div className="seg" id="nwf">
        {([['0', '허용 안 함'], ['all', '전체 회차 허용'], ['eps', '회차별로 정하기']] as const).map(([k, l]) => <button type="button" key={k} className={f.fork === k ? 'on' : ''} aria-pressed={f.fork === k} onClick={() => vm.set({ fork: k })}>{l}</button>)}
      </div><p className="note2" style={{ marginTop: 8 }}>‘회차별로 정하기’는 회차를 공개한 뒤 공개 설정에서 회차마다 켜고 끌 수 있어요. 처음에는 나만 볼 수 있는 상태로 만들어져요.</p></div>
      <button type="button" className="tbtn pri" style={{ width: '100%', height: 56, fontSize: 16, marginTop: 8 }} id="createWork" onClick={vm.create}>소설 만들고 1화 쓰기 →</button>
    </div>
  )
}

/** 목업 worldManager(): 세계관 만들기·조합·편집·버전 복원·공개·이용·복사·삭제 */
function WorldManager({ vm }: { vm: VM }) {
  const w = vm.worlds!
  return (
    <details id="worldManager" className="tcard fstep" open={!w.mine.length || undefined}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>내 세계관 만들기와 관리</summary>
      <p className="small muted" style={{ margin: '8px 0 0' }}>이 페이지에서 세계관을 만들고 관리한 뒤 새 소설에 연결할 수 있어요. 변경 내용은 이 데모의 브라우저 안에서만 유지돼요.</p>
      <form className="panel" id="worldCreate" style={{ marginTop: 18 }} onSubmit={async (e) => { e.preventDefault(); const el = e.currentTarget; if (await vm.createWorld(worldForm(e))) el.reset() }}>
        <h2>세계관 만들기</h2>
        <label className="field">이름<input className="inp" name="name" maxLength={60} required /></label>
        <label className="field">설명<textarea className="ta" name="description" maxLength={500} /></label>
        <label className="field">세계관 규칙 (한 줄에 하나)<textarea className="ta" name="rules" maxLength={2000} /></label>
        <button className="btn pri" type="submit">비공개 세계관 만들기</button>
      </form>
      <div className="sec"><div className="sec-h"><h2>만든 세계관</h2></div>
        {w.mine.length ? w.mine.map((world) => <MyWorld key={world.id + (world.history?.length ?? 0)} world={world} vm={vm} />) : <p className="muted">아직 만든 세계관이 없어요.</p>}
      </div>
      <div className="sec"><h2>이용 가능한 공개 세계관</h2>
        {w.usable.length ? w.usable.map(({ world, rules }) => (
          <div className="panel" key={world.id}><b>{world.name}</b><p>{world.description}</p><p className="small muted">{world.owner} · 이용 허용 · 세계관 포크 {world.allowFork ? '허용' : '불허'}</p><ul>{rules.map((r) => <li key={r}>{r}</li>)}</ul>
            <button type="button" className="btn sm" onClick={() => vm.use(world.id)}>작품에 이용</button>{world.allowFork && <> <button type="button" className="btn sm" onClick={() => vm.copy(world.id)}>내 세계관으로 포크</button></>}</div>
        )) : <p className="muted">이용 가능한 공개 세계관이 없어요.</p>}
      </div>
      <form className="panel" id="combineWorlds" onSubmit={async (e) => {
        e.preventDefault()
        const el = e.currentTarget
        const picks = [...el.querySelectorAll<HTMLInputElement>('[data-combine-world]:checked')].map((x) => ({ worldId: x.dataset.combineWorld ?? '', ruleIndex: Number(x.dataset.ruleIndex) }))
        if (await vm.combine(String(new FormData(el).get('name') ?? ''), picks)) el.reset()
      }}>
        <h2>세계관 항목 조합</h2>
        <label className="field">새 세계관 이름<input className="inp" name="name" maxLength={60} required /></label>
        {w.combinable.map(({ world, rules }) => (
          <fieldset key={world.id}><legend>{world.name}{world.owner ? ' · ' + world.owner : ''}</legend>
            {rules.length ? rules.map(({ rule, index }) => <label className="field" key={index}><span><input type="checkbox" data-combine-world={world.id} data-rule-index={index} /> {rule}</span></label>) : <p className="muted">선택할 규칙이 없어요.</p>}
          </fieldset>
        ))}
        <button className="btn sm pri" type="submit">선택한 항목으로 만들기</button>
      </form>
    </details>
  )
}

function MyWorld({ world: w, vm }: { world: World; vm: VM }) {
  const history = w.history ?? []
  const [version, setVersion] = useState(history.length - 1)
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <form data-world-edit={w.id} onSubmit={(e) => { e.preventDefault(); vm.editWorld(w.id, worldForm(e)) }}>
        <label className="field">이름<input className="inp" name="name" defaultValue={w.name} maxLength={60} required /></label>
        <label className="field">설명<textarea className="ta" name="description" defaultValue={w.description} maxLength={500} /></label>
        <label className="field">세계관 규칙 (한 줄에 하나)<textarea className="ta" name="rules" defaultValue={w.rules.join('\n')} maxLength={2000} /></label>
        <button className="btn sm pri">변경 저장</button>
      </form>
      <span className="chip">{w.public ? '공개' : '비공개'}</span>{' '}
      <button type="button" className="btn sm" onClick={() => vm.togglePublic(w.id, w.public)}>{w.public ? '비공개로 전환' : '공개로 전환'}</button>{' '}
      <button type="button" className="btn sm" onClick={() => vm.remove(w.id)}>세계관 삭제</button>
      <fieldset><legend>세계관에서 공개할 규칙</legend>
        {w.rules.length ? w.rules.map((rule, i) => <label className="field" key={rule}><span><input type="checkbox" checked={!!w.rulePublic?.[rule]} onChange={(e) => vm.setRulePublic(w.id, i, e.target.checked)} /> {rule}</span></label>) : <p className="muted">규칙이 없어요.</p>}
      </fieldset>
      <fieldset><legend>다른 작가의 이용 허용 범위</legend>
        {PERMS.map(([key, label]) => <label className="field" key={key}><span><input type="checkbox" checked={!!w[key]} onChange={(e) => vm.setPermission(w.id, key, e.target.checked)} /> {label}</span></label>)}
      </fieldset>
      <p className="small muted">추출한 설정 {(w.facts ?? []).length}건</p>
      <ul>{(w.facts ?? []).map((f, i) => <li key={i}>{f.text} · {f.source} {f.ep}화</li>)}</ul>
      <label className="field">변경 이력<select className="inp" value={version} onChange={(e) => setVersion(Number(e.target.value))}>
        {history.map((v, i) => <option key={i} value={i}>버전 {i + 1} · {v.name} · {v.rules.length}개 규칙</option>).reverse()}
      </select></label>
      <button type="button" className="btn sm" onClick={() => vm.restore(w.id, version)}>선택한 버전 복원</button>
      <p className="small muted">연결된 작품이 있으면 세계관을 삭제할 수 없어요. 규칙 변경은 연결 작품에도 반영되며 이력에서 복원할 수 있어요.</p>
    </div>
  )
}
