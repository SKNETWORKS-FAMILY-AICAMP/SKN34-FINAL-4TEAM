import {WorldRelationshipEditor} from './WorldRelationshipEditor'
import {cardTypes,cardTypeOf,settingAreas,type CardType,type CardFilter} from '../../../../domain/entities/studioCards'
import { useState, type FormEvent } from 'react'
import type { SettingItem } from '../../../../domain/entities/studioWorld'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import './world-studio.css'

type VM=ReturnType<typeof useWorldStudioViewModel>
const kinds:Record<SettingItem['kind'],string>={entity:'대상',fact:'설정',rule:'규칙',constraint:'제약',claim:'인물의 주장',relation:'관계',undetermined:'미정',event:'과거 사건',note:'메모'}

export function WorldStudioPage() {
 useScreenId('W01')
 const vm=useWorldStudioViewModel()
 const [tab,setTab]=useState('edit')
 const [listOpen,setListOpen]=useState(true)
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);vm.create(String(f.get('name')??''),String(f.get('description')??''))}
 return <><Gnb on="worldstudio"/><main className="wrap world-studio">
  <header className="world-heading"><div><Go to="/worldstudio" className="back">세계관 작업실</Go><h1>세계관 작업실</h1><p className="muted">메모리 데모 · 서버에 저장되지 않으며 새로고침하면 초기화됩니다.</p></div><Go to="/new" className="btn">저장한 세계관으로 새 소설 쓰기</Go></header>
  {vm.error && <p role="alert" className="world-error">{vm.error}</p>}
  {vm.message && <p role="status" className="world-message">{vm.message}</p>}
  <div className={"world-layout"+(listOpen?"":" world-list-collapsed")} aria-busy={vm.busy}>
   <aside id="world-list" className="world-list" hidden={!listOpen}><h2>내 세계관</h2>
    <nav aria-label="내 세계관">{vm.worlds.map(w=><button type="button" key={w.id} disabled={vm.busy} onClick={()=>vm.open(w.id)} aria-current={vm.saved?.id===w.id?'page':undefined}>{w.name}<small>비공개</small></button>)}</nav>
    {!vm.busy && !vm.worlds.length && <p className="muted">아직 저장한 세계관이 없습니다.</p>}
    <form onSubmit={create}><h3>새 세계관 만들기</h3><label className="field">세계관 이름<input className="inp" name="name" required maxLength={100}/></label><label className="field">설명 (선택)<textarea className="ta" name="description" maxLength={20000}/></label><button className="btn pri" disabled={vm.busy}>세계관 만들기</button></form>
   </aside>
   <div className="world-list-divider"><button type="button" className="world-list-toggle" aria-label={listOpen?'세계관 목록 접기':'세계관 목록 펼치기'} aria-expanded={listOpen} aria-controls="world-list" onClick={()=>setListOpen(open=>!open)}><span aria-hidden="true">{listOpen?'‹':'›'}</span></button></div>
   <section className="world-content">{vm.editing?<>
    <div className="world-toolbar"><h2>{vm.saved?.name}</h2><span role="status">{vm.busy?'잠시만 기다려 주세요':vm.dirty?'저장하지 않은 변경사항':'저장됨'}</span><button className="btn pri" disabled={vm.busy || !vm.dirty} onClick={vm.save}>저장</button></div>
    <nav className="libtabs" aria-label="세계관 도구"><button type="button" onClick={()=>setTab('edit')}>설정 작성</button><button type="button" onClick={()=>setTab('relations')}>관계 편집</button></nav>
    <div hidden={tab!=='edit'}><Editor vm={vm}/></div>
    <div hidden={tab!=='relations'}><WorldRelationshipEditor key={vm.editing.id} studio={vm}/></div>
   </>:<div className="world-empty"><h2>{vm.busy?'세계관을 읽고 있습니다':'세계관을 선택하거나 새로 만들어 주세요'}</h2><p className="muted">이름만으로 시작할 수 있습니다. 설정과 인물은 필요한 만큼 추가하세요.</p></div>}</section>
  </div>
 </main><Footer/></>
}

function Editor({vm}:{vm:VM}) {
 const w=vm.editing!
 const [filter,setFilter]=useState<CardFilter>('all')
 const filters=[{id:'all' as const,label:'전체'},...cardTypes,{id:'note' as const,label:'집필 메모'},{id:'review' as const,label:'분류 확인'}]
 const rows=w.settings.filter(s=>filter==='all'||cardTypeOf(s.item)===filter)
 const s=rows.find(s=>s.item.id===vm.selected)??rows[0]
 const type=s?cardTypeOf(s.item):null
 const label=filters.find(f=>f.id===filter)!.label
 const canAdd=filter!=='relation'&&filter!=='review'
 const addType=filter==='all'?'character':filter
 const update=(p:Partial<SettingItem>)=>{if(s)vm.update(s.item.id,p)}
 return <fieldset disabled={vm.busy} className="world-fields"><legend className="sr-only">세계관 편집</legend>
  <div className="world-form-row"><label className="field">세계관 이름<input className="inp" value={w.name} maxLength={100} onChange={e=>vm.patch({name:e.target.value})}/></label>
  <label className="field">세계관 설명<textarea className="ta" value={w.description} maxLength={20000} onChange={e=>vm.patch({description:e.target.value})}/></label></div>
  <h3 className="world-card-heading">설정 카드</h3><p className="small muted">유형으로 카드를 찾고, 카드 안에서 설정 영역을 따로 선택하세요. 관계 없이도 시작할 수 있어요.</p>
  <nav className="world-sections" aria-label="설정 작성 메뉴">{filters.map(f=><button type="button" key={f.id} aria-label={`${f.label} ${w.settings.filter(s=>f.id==='all'||cardTypeOf(s.item)===f.id).length}개`} aria-current={filter===f.id?'page':undefined} onClick={()=>{setFilter(f.id);vm.setSelected('')}}>{f.label}<span>{w.settings.filter(s=>f.id==='all'||cardTypeOf(s.item)===f.id).length}</span></button>)}</nav>
  <div className="world-toolbar"><h3>{label}</h3>{canAdd&&<button className="btn sm" type="button" onClick={()=>vm.addCard(addType as CardType|'note')}>{filter==='all'?'인물':label} 추가</button>}</div>
  {filter==='review'&&<p className="world-compatibility">이전 설정의 의미와 분류를 그대로 보존하고 있어요. 새 카드 유형을 임의로 부여하지 않습니다.</p>}
  <div className="world-settings"><nav aria-label={`${label} 항목`}>{rows.map((x,n)=><button type="button" key={x.item.id} onClick={()=>vm.setSelected(x.item.id)} aria-current={s?.item.id===x.item.id?'page':undefined}>{x.item.title||`새 카드 ${n+1}`}<small>{filters.find(f=>f.id===cardTypeOf(x.item))?.label} · {settingAreas.find(a=>a.id===x.item.category)?.label}</small></button>)}</nav>
  {s?<div className="world-setting-editor">
   <div className="world-form-row"><label className="field">카드 유형<select className="inp" value={type??'review'} onChange={e=>{vm.changeCardType(s.item.id,e.target.value as CardType);setFilter('all')}}>
    {cardTypes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
    {type&&['note','relation','review'].includes(type)&&<option value={type}>{type==='review'?`기존 ${kinds[s.item.kind]} · 분류 확인`:type==='note'?'집필 메모':'기존 관계'}</option>}
   </select></label>
   <label className="field">설정 영역<select className="inp" value={s.item.category} onChange={e=>vm.changeArea(s.item.id,e.target.value as SettingItem['category'])}>{settingAreas.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div>
   {type==='review'&&<p className="world-compatibility">기존 의미: {kinds[s.item.kind]}{s.item.entityType?` · ${s.item.entityType}`:''}. 원문과 연결을 유지하며 편집합니다.</p>}
   <label className="field">항목 이름<input className="inp" value={s.item.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></label>
   <label className="field">내용<textarea className="ta world-text" value={s.item.text} maxLength={3000} placeholder="어떤 설정인가요? 자유롭게 적어 주세요." onChange={e=>update({text:e.target.value})}/></label>
   <div className="world-form-row"><label className="field">내 태그 (쉼표로 구분)<input className="inp" value={s.tags.join(',')} onChange={e=>vm.update(s.item.id,{}, {tags:e.target.value.split(',').map(t=>t.trim())})} onBlur={()=>{if(s.tags.some(t=>!t))vm.update(s.item.id,{}, {tags:s.tags.filter(Boolean)})}}/></label>
   <label className="field">별칭 (선택)<input className="inp" value={s.aliases?.join(',')??''} onChange={e=>vm.update(s.item.id,{}, {aliases:e.target.value.split(',').map(t=>t.trim())})}/></label></div>
   <details className="world-legacy-fields"><summary>기존 정리 정보</summary><label className="field">내 분류<input className="inp" value={s.userCategory} maxLength={50} onChange={e=>vm.update(s.item.id,{}, {userCategory:e.target.value})}/></label><p className="small muted">이전 자유 분류를 보존합니다. 카드 유형이나 설정 영역과는 별개예요.</p></details>
   {s.item.kind==='event'&&<label className="field">사건 시점 (선택)<input className="inp" value={s.item.timeText} onChange={e=>update({timeText:e.target.value})}/></label>}
  </div>:<p className="muted">{canAdd?'카드를 추가해 시작하세요. 인물·장소·조직·능력은 이름만 입력해도 됩니다.':'이 유형의 카드가 없습니다.'}</p>}</div>
 </fieldset>
}
