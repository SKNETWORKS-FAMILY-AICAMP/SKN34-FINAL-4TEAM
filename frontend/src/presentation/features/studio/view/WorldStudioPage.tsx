import { studioSections, sectionOf, type StudioSection } from '../../../../domain/entities/studioSections'
import { useState, type FormEvent } from 'react'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import './world-studio.css'

type VM=ReturnType<typeof useWorldStudioViewModel>

export function WorldStudioPage() {
 useScreenId('W01')
 const vm=useWorldStudioViewModel()
 const [listOpen,setListOpen]=useState(true)
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);vm.create(String(f.get('name')??''),String(f.get('description')??''))}
 return <><Gnb on="worlds"/><main className="wrap world-studio">
  <header className="world-heading"><div><Go to="/worlds" className="back">세계관 작업실</Go><h1>세계관 작업실</h1><p className="muted">인물과 장소, 세계의 규칙을 정리해 보세요. 필요한 항목부터 직접 작성해 보세요.</p></div><Go to="/new" className="btn">새 소설 쓰기</Go></header>
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
    <div className="world-toolbar"><h2>{vm.saved?.name}</h2><span role="status">{vm.busy?'잠시만 기다려 주세요':vm.dirty?'저장하지 않은 변경사항':'저장됨'}</span><button className="btn pri" disabled={vm.busy || !vm.dirty} onClick={vm.save}>저장</button></div>
    <Editor vm={vm}/>
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
   <label className="field">내 분류<input className="inp" value={s.userCategory} maxLength={50} onChange={e=>vm.update(s.item.id,{}, {userCategory:e.target.value})}/></label>
   <label className="field">내용<textarea className="ta world-text" value={s.item.text} maxLength={3000} onChange={e=>update({text:e.target.value})}/></label>
   <label className="field">내 태그 (쉼표로 구분)<input className="inp" value={s.tags.join(',')} onChange={e=>vm.update(s.item.id,{}, {tags:e.target.value.split(',').map(t=>t.trim())})} onBlur={()=>{if(s.tags.some(t=>!t))vm.update(s.item.id,{}, {tags:s.tags.filter(Boolean)})}}/></label>
  </div>:<p className="muted">이 메뉴의 항목을 추가해 주세요. 인물·장소는 이름만 입력해도 되며, 모든 메뉴를 채울 필요는 없습니다.</p>}</div>
 </fieldset>
}
