import { studioSections, sectionOf, type StudioSection } from '../../../../domain/entities/studioSections'
import { useState, type FormEvent } from 'react'
import type { SettingItem } from '../../../../domain/entities/studioWorld'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import './world-studio.css'

type VM=ReturnType<typeof useWorldStudioViewModel>
const kinds:Record<SettingItem['kind'],string>={entity:'대상',fact:'설정',rule:'규칙',constraint:'제약',claim:'인물의 주장',relation:'관계',undetermined:'미정',event:'과거 사건',note:'메모'}
const relations:Record<string,string>={sibling_of:'남매·형제자매',child_of:'자녀',spouse_of:'배우자',trusts:'신뢰',hostile_to:'적대',member_of:'소속',leads:'이끎',can_use:'사용 가능',located_in:'위치'}
const tabs=[['edit','설정 작성'],['wiki','설정집'],['relations','인물 관계도'],['timeline','초기 역사 시간선'],['analysis','AI 후보 검토']] as const

export function WorldStudioPage() {
 useScreenId('W01')
 const vm=useWorldStudioViewModel()
 const [tab,setTab]=useState('edit')
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);vm.create(String(f.get('name')??''),String(f.get('description')??''))}
 return <><Gnb on="worlds"/><main className="wrap world-studio">
  <header className="world-heading"><div><Go to="/worlds" className="back">세계관 작업실</Go><h1>세계관 작업실</h1><p className="muted">인물과 장소, 세계의 규칙을 정리해 보세요. 필요할 때 AI의 도움을 받을 수도 있어요.</p></div><Go to="/new" className="btn">저장한 세계관으로 새 소설 쓰기</Go></header>
  {vm.error && <p role="alert" className="world-error">{vm.error}</p>}
  {vm.message && <p role="status" className="world-message">{vm.message}</p>}
  <div className="world-layout" aria-busy={vm.busy}>
   <aside className="world-list"><h2>내 세계관</h2><details className="world-demo-help"><summary>체험 환경 안내</summary><p className="small muted">지금은 체험용 계정으로 이용할 수 있어요. 내 계정으로 로그인하는 기능은 준비 중이에요.</p><button className="btn sm" type="button" disabled={vm.busy} onClick={vm.connect}>작업실 연결</button></details>
    <nav aria-label="내 세계관">{vm.worlds.map(w=><button type="button" key={w.id} disabled={vm.busy} onClick={()=>vm.open(w.id)} aria-current={vm.saved?.id===w.id?'page':undefined}>{w.name}<small>비공개</small></button>)}</nav>
    {!vm.busy && !vm.worlds.length && <p className="muted">아직 저장한 세계관이 없습니다.</p>}
    <form onSubmit={create}><h3>새 세계관 만들기</h3><label className="field">세계관 이름<input className="inp" name="name" required maxLength={100}/></label><label className="field">설명 (선택)<textarea className="ta" name="description" maxLength={20000}/></label><button className="btn pri" disabled={vm.busy}>세계관 만들기</button></form>
   </aside>
   <section className="world-content">{vm.editing?<>
    <div className="world-toolbar"><h2>{vm.saved?.name}</h2><span role="status">{vm.busy?'잠시만 기다려 주세요':vm.dirty?'저장하지 않은 변경사항':'저장됨'}</span><button className="btn pri" disabled={vm.busy || !vm.dirty} onClick={vm.save}>저장</button></div>
    <nav className="libtabs" aria-label="세계관 도구">{tabs.map(([id,label])=><button type="button" key={id} className={tab===id?'on':''} onClick={()=>setTab(id)} aria-current={tab===id?'page':undefined}>{label}</button>)}</nav>
    {tab==='edit'?<Editor vm={vm}/>:tab==='analysis'?<Analysis vm={vm}/>:<Confirmed vm={vm} tab={tab}/>}
   </>:<div className="world-empty"><h2>{vm.busy?'세계관을 읽고 있습니다':'세계관을 선택하거나 새로 만들어 주세요'}</h2><p className="muted">이름만으로 시작할 수 있습니다. 설정과 인물은 필요한 만큼 추가하세요.</p></div>}</section>
  </div>
 </main><Footer storage="core"/></>
}

function Editor({vm}:{vm:VM}) {
 const w=vm.editing!
 const [section,setSection]=useState<StudioSection>('basic')
 const rows=w.settings.filter(s=>sectionOf(s.item)===section)
 const s=rows.find(s=>s.item.id===vm.selected)??rows[0]
 const label=studioSections.find(s=>s.id===section)!.label
 const update=(p:Partial<typeof w.settings[number]['item']>)=>{if(!s)return;vm.update(s.item.id,p);setSection(sectionOf({...s.item,...p}))}
 return <fieldset disabled={vm.busy} className="world-fields"><legend className="sr-only">세계관 편집</legend>
  <label className="field">세계관 이름<input className="inp" value={w.name} maxLength={100} onChange={e=>vm.patch({name:e.target.value})}/></label>
  <label className="field">세계관 설명<textarea className="ta" value={w.description} maxLength={20000} onChange={e=>vm.patch({description:e.target.value})}/></label>
  <nav className="world-sections" aria-label="설정 작성 메뉴">{studioSections.map(menu=><button type="button" key={menu.id} aria-label={`${menu.label} ${w.settings.filter(s=>sectionOf(s.item)===menu.id).length}개`} aria-current={section===menu.id?'page':undefined} onClick={()=>{setSection(menu.id);vm.setSelected('')}}>{menu.label}<span>{w.settings.filter(s=>sectionOf(s.item)===menu.id).length}</span></button>)}</nav>
  <div className="world-toolbar"><h3>{label}</h3><button className="btn sm" type="button" onClick={()=>vm.add(section)}>{label} 추가</button></div>
  <div className="world-settings"><nav aria-label={`${label} 항목`}>{rows.map((x,n)=><button type="button" key={x.item.id} onClick={()=>vm.setSelected(x.item.id)} aria-current={s?.item.id===x.item.id?'page':undefined}>{x.item.title||`새 ${label} ${n+1}`}{x.userCategory!=='설정'&&<small>{x.userCategory}</small>}</button>)}</nav>
  {s?<div className="world-setting-editor">
   <label className="field">항목 이름<input className="inp" value={s.item.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></label>
   <div className="world-form-row"><label className="field">내 분류<input className="inp" value={s.userCategory} maxLength={50} onChange={e=>vm.update(s.item.id,{}, {userCategory:e.target.value})}/></label>
   <label className="field">항목 종류<select className="inp" value={s.item.kind} onChange={e=>update({kind:e.target.value as SettingItem['kind'],category:e.target.value==='event'?'history':'basic',entityType:e.target.value==='entity'?'character':null,predicate:e.target.value==='relation'?'trusts':null,subjectId:null,targetId:null,timeText:'',afterId:null,topics:[]})}>{Object.entries(kinds).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label></div>
   <label className="field">내용<textarea className="ta world-text" value={s.item.text} maxLength={3000} onChange={e=>update({text:e.target.value})}/></label>
   <label className="field">내 태그 (쉼표로 구분)<input className="inp" value={s.tags.join(',')} onChange={e=>vm.update(s.item.id,{}, {tags:e.target.value.split(',').map(t=>t.trim())})} onBlur={()=>{if(s.tags.some(t=>!t))vm.update(s.item.id,{}, {tags:s.tags.filter(Boolean)})}}/></label>
   {s.item.kind==='entity' && <label className="field">대상 종류<select className="inp" value={s.item.entityType??'character'} onChange={e=>update({entityType:e.target.value})}>{Object.entries({character:'인물',location:'장소',organization:'조직',ability:'능력'}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
   {s.item.kind==='relation' && <><label className="field">관계<select className="inp" value={s.item.predicate??'trusts'} onChange={e=>update({predicate:e.target.value})}>{Object.entries(relations).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>{(['subjectId','targetId'] as const).map((key,n)=><label className="field" key={key}>{n?'관계 대상':'관계 주체'}<select className="inp" value={s.item[key]??''} onChange={e=>update({[key]:e.target.value||null})}><option value="">선택해 주세요</option>{w.settings.filter(x=>x.item.kind==='entity').map(x=><option value={x.item.id} key={x.item.id}>{x.item.title}</option>)}</select></label>)}</>}
   {s.item.kind==='event' && <label className="field">사건 시점 (선택)<input className="inp" value={s.item.timeText} onChange={e=>update({timeText:e.target.value})}/></label>}
  </div>:<p className="muted">이 메뉴의 항목을 추가해 주세요. 인물·장소는 이름만 입력해도 되며, 모든 메뉴를 채울 필요는 없습니다.</p>}</div>
 </fieldset>
}

function Confirmed({vm,tab}:{vm:VM;tab:string}) {
 const items=vm.saved?.settings.map(s=>s.item)??[]
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 const rows=tab==='relations'?items.filter(i=>i.kind==='relation'):tab==='timeline'?items.filter(i=>i.kind==='event'):items
 return <section className="world-confirmed"><h3>{tab==='relations'?'확정 관계도':tab==='timeline'?'확정 시간선':'확정 Wiki'}</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p>{!rows.length?<p className="world-empty">아직 확정한 {tab==='relations'?'관계':tab==='timeline'?'과거 사건':'설정'}가 없습니다.</p>:rows.map(i=><article key={i.id}>
  <h4>{tab==='relations'?`${byId(i.subjectId)} → ${relations[i.predicate??'']??i.predicate} → ${byId(i.targetId)}`:i.title}</h4>{tab==='timeline' && <p className="small muted">{i.timeText||'시점 미지정'}{i.afterId?' · '+byId(i.afterId)+' 이후':''}</p>}<p className="world-prose">{i.text}</p>
 </article>)}</section>
}

function Analysis({vm}:{vm:VM}) {
 const [consent,setConsent]=useState(false)
 const run=vm.saved?.analysis
 return <section className="world-analysis"><h3>선택적 AI 분석</h3><p className="muted">저장한 설명과 설정을 분석해 후보를 만듭니다. 직접 적은 분류·태그는 유지돼요. 제안받은 내용은 선택한 것만 저장할 수 있어요.</p>
  {!vm.aiEnabled && <p className="note2">서버에서 AI 분석을 꺼 두었습니다. 직접 작성과 저장은 계속 사용할 수 있습니다.</p>}
  <label className="world-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={!vm.aiEnabled || vm.busy}/>저장한 설정의 외부 AI 처리를 요청합니다.</label>
  <button className="btn" disabled={!vm.aiEnabled || vm.busy || vm.dirty || !consent} onClick={vm.analyze}>AI 분석 요청</button>{vm.dirty && <p className="small">변경한 설정을 먼저 확정 저장해 주세요.</p>}
  {run && <div className="world-review"><h3>{run.status==='failed'?'분석 실패':run.status==='running'?'분석 진행 중':'AI 후보 · 미확정'}</h3>{run.issues.map((s,n)=><p role="alert" key={n}>{s}</p>)}
   {run.status==='review' && <><p className="small muted">후보를 수정한 뒤 선택하여 확정할 수 있습니다. 미해결 항목은 먼저 정정하세요.</p>{run.candidates.map(c=>{const i=vm.edits[c.id]??c;return <div className="world-candidate" key={c.id}>
    <label className="world-consent"><input type="checkbox" checked={vm.picks.includes(c.id)} disabled={vm.busy || c.decision==='approved'} onChange={e=>vm.toggle(c.id,e.target.checked)}/>{c.decision==='approved'?'확정됨':'후보 선택'} · {kinds[c.kind]} · {c.title}</label>
    <label className="field">후보 이름<input className="inp" value={i.title} disabled={vm.busy || c.decision==='approved'} onChange={e=>vm.editCandidate({...i,title:e.target.value})}/></label>
    <label className="field">후보 내용<textarea className="ta" value={i.text} disabled={vm.busy || c.decision==='approved'} onChange={e=>vm.editCandidate({...i,text:e.target.value})}/></label><p className="small muted">원문 근거: {c.evidence.map(e=>e.quote).join(' / ')||'작가 정정'}</p>
   </div>})}<button className="btn pri" disabled={vm.busy || vm.dirty || !vm.picks.length} onClick={vm.approve}>선택한 후보 확정</button></>}
  </div>}
 </section>
}
