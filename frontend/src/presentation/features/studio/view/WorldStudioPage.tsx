import {cardTypes,cardTypeOf,settingAreas,type CardType,type CardFilter} from '../../../../domain/entities/studioCards'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SettingItem } from '../../../../domain/entities/studioWorld'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import './world-studio.css'
import { WorldMap } from './WorldMap'
import { WorldRelationshipEditor } from './WorldRelationshipEditor'
import { relationDefinitions, relationLabel } from '../../../../domain/entities/studioRelations'

type VM=ReturnType<typeof useWorldStudioViewModel>
const kinds:Record<SettingItem['kind'],string>={entity:'대상',fact:'설정',rule:'규칙',constraint:'제약',claim:'인물의 주장',relation:'관계',undetermined:'미정',event:'과거 사건',note:'메모'}
const relations=Object.fromEntries(Object.entries(relationDefinitions).map(([key,value])=>[key,value.label]))
const tabs=[['edit','설정 작성'],['relationship-edit','관계 편집'],['explore','세계관 탐색'],['analysis','AI 후보 검토']] as const
const exploreTabs=[['map','전체 세계관 지도'],['wiki','설정집'],['relations','인물 관계도'],['timeline','초기 역사 시간선']] as const

export function WorldStudioPage() {
 useScreenId('W01')
 const vm=useWorldStudioViewModel()
 const [tab,setTab]=useState('edit')
 const [explore,setExplore]=useState('map')
 const [relationshipWorld,setRelationshipWorld]=useState('')
 const returnCard=useRef('')
 const [relationEntry,setRelationEntry]=useState<{id:string;sequence:number}|null>(null)
 const editorRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{setTab('edit');setRelationshipWorld('');setRelationEntry(null);returnCard.current=''},[vm.editing?.id])
 const openRelations=(id:string)=>{returnCard.current=id;setRelationEntry(entry=>({id,sequence:(entry?.sequence??0)+1}));vm.setSelected(id);setRelationshipWorld(vm.editing!.id);setTab('relationship-edit')}
 const returnToCard=()=>{if(returnCard.current)vm.setSelected(returnCard.current);setTab('edit');requestAnimationFrame(()=>editorRef.current?.querySelector<HTMLInputElement>('[data-card-title]')?.focus())}
 const [listOpen,setListOpen]=useState(true)
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);vm.create(String(f.get('name')??''),String(f.get('description')??''))}
 return <><Gnb on="worlds"/><main className="wrap world-studio">
  <header className="world-heading"><div><Go to="/worlds" className="back">세계관 작업실</Go><h1>세계관 작업실</h1><p className="muted">인물과 장소, 세계의 규칙을 정리해 보세요. 필요할 때 AI의 도움을 받을 수도 있어요.</p></div><Go to="/new" className="btn">저장한 세계관으로 새 소설 쓰기</Go></header>
  {vm.error && <p role="alert" className="world-error">{vm.error}</p>}
  {vm.message && <p role="status" className="world-message">{vm.message}</p>}
  <div className={"world-layout"+(listOpen?"":" world-list-collapsed")} aria-busy={vm.busy}>
   <aside id="world-list" className="world-list" hidden={!listOpen}><h2>내 세계관</h2><details className="world-demo-help"><summary>체험 환경 안내</summary><p className="small muted">지금은 체험용 계정으로 이용할 수 있어요. 내 계정으로 로그인하는 기능은 준비 중이에요.</p><button className="btn sm" type="button" disabled={vm.busy} onClick={vm.connect}>작업실 연결</button></details>
    <nav aria-label="내 세계관">{vm.worlds.map(w=><button type="button" key={w.id} disabled={vm.busy} onClick={()=>vm.open(w.id)} aria-current={vm.saved?.id===w.id?'page':undefined}>{w.name}<small>비공개</small></button>)}</nav>
    {!vm.busy && !vm.worlds.length && <p className="muted">아직 저장한 세계관이 없습니다.</p>}
    <form onSubmit={create}><h3>새 세계관 만들기</h3><label className="field">세계관 이름<input className="inp" name="name" required maxLength={100}/></label><label className="field">설명 (선택)<textarea className="ta" name="description" maxLength={20000}/></label><button className="btn pri" disabled={vm.busy}>세계관 만들기</button></form>
   </aside>
   <div className="world-list-divider"><button type="button" className="world-list-toggle" aria-label={listOpen?'세계관 목록 접기':'세계관 목록 펼치기'} aria-expanded={listOpen} aria-controls="world-list" onClick={()=>setListOpen(open=>!open)}><span aria-hidden="true">{listOpen?'‹':'›'}</span></button></div>
   <section className="world-content">{vm.editing?<>
    <div className="world-toolbar"><h2>{vm.saved?.name}</h2><span role="status">{vm.saveState==='saving'?'저장 중':vm.busy?'처리 중':vm.storageIssues.length?'지원하지 않는 입력으로 저장할 수 없음':vm.saveState==='failed'?'저장 실패 · 입력은 유지됩니다':vm.dirty?'저장하지 않은 변경사항':'저장됨'}</span><button className="btn pri" disabled={vm.busy || !vm.dirty || vm.storageIssues.length>0} onClick={vm.save}>저장</button></div>
    {vm.storageIssues.map(issue=><p role="alert" className="world-error" key={issue}>{issue}</p>)}
    <nav className="libtabs" aria-label="세계관 도구">{tabs.map(([id,label])=><button type="button" key={id} className={tab===id?'on':''} onClick={()=>{if(id==='relationship-edit')setRelationshipWorld(vm.editing!.id);setTab(id)}} aria-current={tab===id?'page':undefined}>{label}</button>)}</nav>
    <p className="small muted">저장은 작품의 발행·공개와 다릅니다. 관계는 필요한 경우에만 연결하세요.</p>
    <div ref={editorRef} hidden={tab!=='edit'}><Editor key={vm.editing.id} vm={vm} onOpenRelations={openRelations}/></div>
    {relationshipWorld===vm.editing.id&&<div hidden={tab!=='relationship-edit'}><button className="btn sm" type="button" onClick={returnToCard}>설정 카드로 돌아가기</button><WorldRelationshipEditor key={vm.editing.id} studio={vm} active={tab==='relationship-edit'} entry={relationEntry}/></div>}
    {tab==='explore'&&<><nav className="libtabs world-explore-tabs" aria-label="세계관 탐색 보기">{exploreTabs.map(([id,label])=><button type="button" key={id} className={explore===id?'on':''} aria-current={explore===id?'page':undefined} onClick={()=>setExplore(id)}>{label}</button>)}</nav>{explore==='map'&&vm.saved?<WorldMap key={`${vm.saved.id}:${vm.saved.version}`} world={vm.saved}/>:<Confirmed vm={vm} tab={explore}/>}</>}
    <div hidden={tab!=='analysis'}><Analysis key={vm.editing.id} vm={vm}/></div>
   </>:<div className="world-empty"><h2>{vm.busy?'세계관을 읽고 있습니다':'세계관을 선택하거나 새로 만들어 주세요'}</h2><p className="muted">이름만으로 시작할 수 있습니다. 설정과 인물은 필요한 만큼 추가하세요.</p></div>}</section>
  </div>
 </main><Footer storage="core"/></>
}

function Editor({vm,onOpenRelations}:{vm:VM;onOpenRelations:(id:string)=>void}) {
 const w=vm.editing!
 const [filter,setFilter]=useState<CardFilter>('all')
 const filters=[{id:'all' as const,label:'전체'},...cardTypes,{id:'note' as const,label:'집필 메모'},{id:'relation' as const,label:'기존 관계'},{id:'review' as const,label:'분류 확인'}]
 const [area,setArea]=useState('all'),[query,setQuery]=useState(''),[detail,setDetail]=useState(false)
 const titleRef=useRef<HTMLInputElement>(null),listRef=useRef<HTMLDivElement>(null)
 const rows=w.settings.filter(s=>(filter==='all'||cardTypeOf(s.item)===filter)&&(area==='all'||s.item.category===area)&&[s.item.title,s.item.text,...s.tags].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const s=w.settings.find(s=>s.item.id===vm.selected)??w.settings[0]
 const type=s?cardTypeOf(s.item):null
 const label=filters.find(f=>f.id===filter)!.label
 const canAdd=filter!=='relation'&&filter!=='review'&&filter!=='object'&&filter!=='other'
 const addType=filter==='all'?'character':filter
 const update=(p:Partial<SettingItem>)=>{if(s)vm.update(s.item.id,p)}
 return <fieldset disabled={vm.busy} className="world-fields"><legend className="sr-only">세계관 편집</legend>
  <div className="world-form-row"><label className="field">세계관 이름<input className="inp" value={w.name} maxLength={100} onChange={e=>vm.patch({name:e.target.value})}/></label>
  <label className="field">세계관 설명<textarea className="ta" value={w.description} maxLength={20000} onChange={e=>vm.patch({description:e.target.value})}/></label></div>
  <h3 className="world-card-heading">설정 카드</h3><p className="small muted">유형으로 카드를 찾고, 카드 안에서 설정 영역을 따로 선택하세요. 관계 없이도 시작할 수 있어요.</p>
  <div className={"world-card-workspace"+(detail?" showing-detail":"")}><div className="world-card-library" ref={listRef} tabIndex={-1}><nav className="world-sections" aria-label="설정 작성 메뉴">{filters.map(f=><button type="button" key={f.id} aria-label={`${f.label} ${w.settings.filter(s=>f.id==='all'||cardTypeOf(s.item)===f.id).length}개`} aria-current={filter===f.id?'page':undefined} onClick={()=>setFilter(f.id)}>{f.label}<span>{w.settings.filter(s=>f.id==='all'||cardTypeOf(s.item)===f.id).length}</span></button>)}</nav>
  <label className="field">카드 검색<input type="search" className="inp" value={query} onChange={e=>setQuery(e.target.value)} placeholder="이름, 설명, 태그"/></label><label className="field">영역 필터<select className="inp" value={area} onChange={e=>setArea(e.target.value)}><option value="all">모든 영역</option>{settingAreas.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label><div className="world-toolbar"><h3>{label}</h3>{canAdd&&<button className="btn sm" type="button" onClick={()=>{vm.addCard(addType as CardType|'note');setDetail(true);requestAnimationFrame(()=>titleRef.current?.focus())}}>{filter==='all'?'인물':label} 추가</button>}</div>
  {(filter==='object'||filter==='other')&&<p className="world-compatibility" role="status">{label} 카드의 유형을 보존하는 저장 기능을 준비 중입니다. 다른 유형으로 대신 저장하지 않아요.</p>}
  {filter==='review'&&<p className="world-compatibility">이전 설정의 의미와 분류를 그대로 보존하고 있어요. 새 카드 유형을 임의로 부여하지 않습니다.</p>}

  <div className="world-settings"><nav aria-label={`${label} 항목`}>{rows.map((x,n)=><button type="button" key={x.item.id} onClick={()=>{vm.setSelected(x.item.id);setDetail(true);requestAnimationFrame(()=>titleRef.current?.focus())}} aria-current={s?.item.id===x.item.id?'page':undefined}>{x.item.title||`새 카드 ${n+1}`}<small>{filters.find(f=>f.id===cardTypeOf(x.item))?.label} · {settingAreas.find(a=>a.id===x.item.category)?.label}</small></button>)}</nav>{!rows.length&&<p className="muted">조건에 맞는 카드가 없습니다. 다른 유형이나 영역을 선택해 주세요.</p>}</div></div>
  {s?<div className="world-setting-editor"><button className="btn sm world-mobile-list" type="button" onClick={()=>{setDetail(false);requestAnimationFrame(()=>listRef.current?.focus())}}>카드 목록으로</button>{!rows.some(row=>row.item.id===s.item.id)&&<p className="small muted">선택한 카드를 계속 편집하고 있어요. 목록의 필터는 카드 내용을 바꾸지 않습니다.</p>}{type==='character'&&<button className="btn sm" type="button" onClick={()=>onOpenRelations(s.item.id)}>이 인물의 관계 편집</button>}
   <div className="world-form-row"><label className="field">카드 유형<select className="inp" value={type??'review'} onChange={e=>{vm.changeCardType(s.item.id,e.target.value as CardType);setFilter('all')}}>
    {cardTypes.map(t=><option key={t.id} value={t.id} disabled={t.id==='object'||t.id==='other'}>{t.label}</option>)}
    {type&&['note','relation','review'].includes(type)&&<option value={type}>{type==='review'?`기존 ${kinds[s.item.kind]} · 분류 확인`:type==='note'?'집필 메모':'기존 관계'}</option>}
   </select></label>
   <label className="field">설정 영역<select className="inp" value={s.item.category} onChange={e=>vm.changeArea(s.item.id,e.target.value as SettingItem['category'])}>{settingAreas.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div>
   <p className="small muted">사물·기타 유형과 별칭 저장은 준비 중입니다. 기존 설정을 다른 유형으로 자동 변환하지 않아요.</p>
   {type==='review'&&<p className="world-compatibility">기존 의미: {kinds[s.item.kind]}{s.item.entityType?` · ${s.item.entityType}`:''}. 원문과 연결을 유지하며 편집합니다.</p>}
   <label className="field">항목 이름<input ref={titleRef} data-card-title className="inp" value={s.item.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></label>
   <label className="field">내용<textarea className="ta world-text" value={s.item.text} maxLength={3000} placeholder="어떤 설정인가요? 자유롭게 적어 주세요." onChange={e=>update({text:e.target.value})}/></label>
   <div className="world-form-row"><label className="field">내 태그 (쉼표로 구분)<input className="inp" value={s.tags.join(',')} onChange={e=>vm.update(s.item.id,{}, {tags:e.target.value.split(',').map(t=>t.trim())})} onBlur={()=>{if(s.tags.some(t=>!t))vm.update(s.item.id,{}, {tags:s.tags.filter(Boolean)})}}/></label>
   <label className="field">별칭 (선택)<input className="inp" value={s.aliases?.join(',')??''} disabled aria-describedby="aliases-help"/></label></div>
   <p id="aliases-help" className="small muted">별칭 전용 저장 기능은 준비 중입니다.</p>
   <details className="world-legacy-fields"><summary>기존 정리 정보</summary><label className="field">내 분류<input className="inp" value={s.userCategory} maxLength={50} onChange={e=>vm.update(s.item.id,{}, {userCategory:e.target.value})}/></label><p className="small muted">이전 자유 분류를 보존합니다. 카드 유형이나 설정 영역과는 별개예요.</p></details>
   {s.item.kind==='relation'&&<><label className="field">관계<select className="inp" value={s.item.predicate??'trusts'} onChange={e=>update({predicate:e.target.value})}>{Object.entries(relations).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>{(['subjectId','targetId'] as const).map((key,n)=><label className="field" key={key}>{n?'관계 대상':'관계 주체'}<select className="inp" value={s.item[key]??''} onChange={e=>update({[key]:e.target.value||null})}><option value="">선택해 주세요</option>{w.settings.filter(x=>x.item.kind==='entity').map(x=><option value={x.item.id} key={x.item.id}>{x.item.title}</option>)}</select></label>)}</>}
   {s.item.kind==='event'&&<label className="field">사건 시점 (선택)<input className="inp" value={s.item.timeText} onChange={e=>update({timeText:e.target.value})}/></label>}
  </div>:<p className="muted">{canAdd?'카드를 추가해 시작하세요. 인물·장소·조직·능력은 이름만 입력해도 됩니다.':'이 유형의 카드가 없습니다.'}</p>}</div>
 </fieldset>
}

function Confirmed({vm,tab}:{vm:VM;tab:string}) {
 const items=vm.saved?.settings.map(s=>s.item)??[]
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 const rows=tab==='relations'?items.filter(i=>i.kind==='relation'):tab==='timeline'?items.filter(i=>i.kind==='event'):items
 return <section className="world-confirmed"><h3>{tab==='relations'?'확정 관계도':tab==='timeline'?'확정 시간선':'확정 Wiki'}</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p>{!rows.length?<p className="world-empty">아직 확정한 {tab==='relations'?'관계':tab==='timeline'?'과거 사건':'설정'}가 없습니다.</p>:rows.map(i=><article key={i.id}>
  <h4>{tab==='relations'?`${byId(i.subjectId)} → ${relationLabel(i)} → ${byId(i.targetId)}`:i.title}</h4>{tab==='timeline' && <p className="small muted">{i.timeText||'시점 미지정'}{i.afterId?' · '+byId(i.afterId)+' 이후':''}</p>}<p className="world-prose">{i.text}</p>
 </article>)}</section>
}

function Analysis({vm}:{vm:VM}) {
 const [consent,setConsent]=useState(false)
 const run=vm.saved?.analysis
 return <section className="world-analysis"><h3>선택적 AI 분석</h3><p className="muted">저장한 설명과 설정을 분석해 후보를 만듭니다. 직접 적은 분류·태그는 유지돼요. 현재는 선택한 후보를 확정하면 서버의 저장 설정에 바로 반영됩니다. 직접 작성한 변경은 위의 저장 버튼으로 저장하세요.</p>
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
