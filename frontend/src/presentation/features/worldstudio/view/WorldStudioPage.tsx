import {studioLabelCleanup} from '../../../../domain/entities/studioWorld'
import {useEffect,useRef,type FormEvent} from 'react'
import {cardTypes,cardTypeOf,settingAreas,type CardType} from '../../../../domain/entities/studioCards'
import type {StudioSetting,SettingItem} from '../../../../domain/entities/studioWorld'
import {relationDefinitions,relationLabel} from '../../../../domain/entities/studioRelations'
import {Go} from '../../../shared/Go'
import {useScreenId} from '../../../shared/screenIds'
import {useDocumentTitle} from '../../../shared/useDocumentTitle'
import {Gnb} from '../../../shared/shell/Gnb'
import {useWorldStudioViewModel} from '../viewmodel/useWorldStudioViewModel'
import {WorldMap} from './WorldMap'
import {WorldRelationshipEditor} from './WorldRelationshipEditor'
import {WorldWiki} from './WorldWiki'
import {WorldTimeline} from './WorldTimeline'
import {WorldCandidates} from './WorldCandidates'
import {presentationPortrait} from '../../../../app/presentationPortraits'
import './world-studio.css'

type VM=ReturnType<typeof useWorldStudioViewModel>
const kinds:Record<SettingItem['kind'],string>={entity:'대상',fact:'설정',rule:'규칙',constraint:'제약',claim:'인물의 주장',relation:'관계',undetermined:'미정',event:'과거 사건',note:'메모'}
const steps=[['info','기본 정보'],['cards','설정 카드'],['relations','관계 연결 (선택)'],['review','검토·저장']] as const
const exploreTabs=[['map','전체 세계관 지도'],['wiki','설정집'],['relations','인물 관계도'],['timeline','초기 역사 시간선']] as const
const labelOf=(setting:StudioSetting)=>cardTypes.find(t=>t.id===cardTypeOf(setting.item))?.label??kinds[setting.item.kind]

export function WorldStudioPage(){
 useScreenId('W01')
 useDocumentTitle('세계관')
 const vm=useWorldStudioViewModel(),heading=useRef<HTMLHeadingElement>(null),tools=useRef<HTMLDetailsElement>(null)
 useEffect(()=>{if(vm.flow.screen==='editor')heading.current?.focus({preventScroll:true})},[vm.flow.step,vm.flow.screen])
 const current=steps.findIndex(([id])=>id===vm.flow.step)
 const chooseTool=(tool:'explore'|'analysis')=>{vm.setTool(tool);if(tools.current)tools.current.open=false}
 return <><Gnb on="worldstudio"/><main id="main" tabIndex={-1} className="wrap world-studio world-writing">
  <header className="world-heading"><div><h1>{vm.editing?'세계관 작성':'세계관 작업실'}</h1><p className="muted">{vm.storage.intro}</p></div></header>
  {vm.error&&<p role="alert" className="world-error">{vm.error}</p>}
  {vm.message&&<p role="status" className="world-message">{vm.message}</p>}
  <WorldLibrary vm={vm}/>
  {vm.editing&&<section className="world-content" hidden={vm.flow.screen!=='editor'} aria-busy={vm.busy}>
   <div className="world-toolbar"><button type="button" className="btn sm" onClick={vm.showList}>내 세계관</button><h2>{vm.saved?.name}</h2><span role="status" className="world-save-state">{vm.saveState==='saving'?'저장 중':vm.saveState==='failed'?'저장 실패 · 입력은 유지됩니다':vm.dirty?'작성 중 · 미저장':'저장됨'}</span>{vm.relationDirty&&<span role="status" className="small muted">관계 입력 미적용</span>}
    <details className="world-tools" ref={tools}><summary>도구</summary><div><button type="button" onClick={()=>chooseTool('explore')}>세계관 탐색</button><button type="button" onClick={()=>chooseTool('analysis')}>AI 후보 검토</button><button type="button" onClick={()=>{vm.goStep('cards');vm.addCard('note');vm.setCardDetail(true);if(tools.current)tools.current.open=false}}>집필 메모 추가</button><Go to={import.meta.env.MODE === 'mockup' ? '/new' : '/content'}>새 소설 등록으로</Go></div></details>
   </div>
   {vm.tool!=='write'&&<button className="btn sm world-return" type="button" onClick={()=>vm.setTool('write')}>작성으로 돌아가기</button>}
   <div hidden={vm.tool!=='write'}>
    <nav className="world-step-nav" aria-label="세계관 작성 단계"><ol>{steps.map(([id,label],i)=><li key={id}><button type="button" aria-current={vm.flow.step===id?'step':undefined} onClick={()=>vm.goStep(id)}><span aria-hidden="true">{i+1}</span>{label}</button></li>)}</ol></nav>
    <h3 className="world-step-title" ref={heading} tabIndex={-1}>{steps[current][1]}</h3>
    <fieldset className="world-fields world-basic" disabled={vm.busy} hidden={vm.flow.step!=='info'}><legend className="sr-only">세계관 기본 정보</legend>
     <label className="field">세계관 이름<input className="inp" required value={vm.editing.name} maxLength={100} onChange={e=>vm.patch({name:e.target.value})}/></label>
     <label className="field">세계관 설명<textarea className="ta world-natural-input" rows={6} value={vm.editing.description} maxLength={20000} placeholder="어떤 시대와 배경에서 시작하나요? 정해 둔 세계의 모습을 자유롭게 적어 주세요." onChange={e=>vm.patch({description:e.target.value})}/></label>
     <p className="small muted">이름만 정해도 시작할 수 있어요. 자세한 설정은 나중에 추가하세요.</p>
    </fieldset>
    <div hidden={vm.flow.step!=='cards'}><CardWriting vm={vm}/></div>
    {vm.relationWorld===vm.editing.id&&<div hidden={vm.flow.step!=='relations'}><p className="muted">관계는 필요한 경우에만 연결하세요. 건너뛰어도 저장할 수 있어요.</p><button className="btn sm" type="button" onClick={vm.returnToCard}>설정 카드로 돌아가기</button><WorldRelationshipEditor key={`${vm.editing.id}:${vm.relationKey}`} studio={vm}/></div>}
    <div hidden={vm.flow.step!=='review'}><WritingReview vm={vm}/></div>
    <nav className="world-step-actions" aria-label="단계 이동"><button className="btn" type="button" disabled={current===0} onClick={()=>vm.goStep(steps[current-1][0])}>이전 단계</button>{current<3&&<button className="btn pri" type="button" onClick={()=>vm.goStep(steps[current+1][0])}>{vm.flow.step==='relations'?'검토·저장으로':'다음 단계'}</button>}{vm.flow.step==='cards'&&<button className="btn" type="button" onClick={()=>vm.goStep('review')}>관계 없이 검토·저장</button>}</nav>
   </div>
   {vm.tool==='explore'&&<><nav className="libtabs" aria-label="세계관 탐색 보기">{exploreTabs.map(([id,label])=><button type="button" key={id} className={vm.explore===id?'on':''} aria-pressed={vm.explore===id} onClick={()=>vm.setExplore(id)}>{label}</button>)}</nav>{(vm.explore==='map'||vm.explore==='relations')&&vm.saved?<WorldMap key={`${vm.saved.id}:${vm.saved.version}:${vm.explore}`} world={vm.saved} charactersOnly={vm.explore==='relations'}/>:<Confirmed vm={vm} tab={vm.explore}/>}</>}
   <div hidden={vm.tool!=='analysis'}><Analysis key={vm.editing.id} vm={vm}/></div>
  </section>}
 </main><footer className="foot"><div className="wrap"><b>STORYFORK</b><Go to="/lib">내 서재</Go></div></footer></>
}
function WorldLibrary({vm}:{vm:VM}){
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);vm.create(String(form.get('name')??''),String(form.get('description')??''))}
 return <section className="world-library" hidden={vm.flow.screen!=='list'} aria-busy={vm.busy}><div className="world-toolbar"><h2>내 세계관</h2>{vm.editing&&<button className="btn" type="button" onClick={vm.resume}>이어서 작성</button>}</div>
  <p className="small muted">{vm.storage.library}</p>
  <nav aria-label="내 세계관">{vm.worlds.map(w=><button key={w.id} type="button" disabled={vm.busy} onClick={()=>vm.editing?.id===w.id?vm.resume():vm.open(w.id)}><strong>{w.name}</strong><small>{w.description||'세계관 설명 없음'}{w.relationshipStatus==='incomplete'?' · 저장 미완료':w.relationshipStatus==='migration_required'?' · 기존 데이터 전환 필요':''}</small></button>)}</nav>
  {!vm.busy&&!vm.worlds.length&&!vm.error&&<p className="muted">아직 저장한 세계관이 없어요. 이름부터 정해 시작해 보세요.</p>}
  <form onSubmit={create}><h3>새 세계관 만들기</h3><label className="field">세계관 이름<input name="name" className="inp" required maxLength={100}/></label><label className="field">설명 (선택)<textarea name="description" className="ta" rows={3} maxLength={20000}/></label><button className="btn pri" disabled={vm.busy}>세계관 만들기</button></form>
 </section>
}
function SettingIcon({setting}:{setting:StudioSetting}){
 const person=cardTypeOf(setting.item)==='character'
 return <svg aria-hidden="true" className="world-setting-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{person?<><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>:<><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5"/></>}</svg>
}
function CardWriting({vm}:{vm:VM}){
 const world=vm.editing!,field=useRef<HTMLInputElement>(null)
 const setting=world.settings.find(s=>s.item.id===vm.selected)??vm.cardRows[0]
 const legacy=world.settings.filter(s=>['relation','review','note'].includes(cardTypeOf(s.item)))
 const editingOutside=setting&&cardTypes.some(type=>type.id===cardTypeOf(setting.item))&&!vm.cardRows.some(row=>row.item.id===setting.item.id)
 const select=(id:string)=>{vm.editCard(id);requestAnimationFrame(()=>field.current?.focus())}
 const add=()=>{vm.setCardFilter('all');vm.setCardQuery('');vm.addCard(vm.newCardType);vm.setCardDetail(true);requestAnimationFrame(()=>field.current?.focus())}
 return <fieldset className="world-fields" disabled={vm.busy}><legend className="sr-only">설정 카드 작성</legend>
  <div className="world-card-intro"><p className="muted">인물이나 장소 등 세계의 설정을 자유롭게 작성해 보세요.</p><div className="world-add"><label className="sr-only" htmlFor="new-setting-type">추가할 설정 유형</label><select id="new-setting-type" className="inp" value={vm.newCardType} onChange={e=>vm.setNewCardType(e.target.value as CardType)}>{cardTypes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select><button type="button" className="btn pri" aria-label="설정 추가" onClick={add}><span aria-hidden="true">+</span> 설정 추가</button></div></div>
  <div className={'world-card-workspace'+(vm.cardDetail?' showing-detail':'')}>
   <aside className="world-card-library" aria-label="설정 목록"><div className="world-card-filters"><label className="sr-only" htmlFor="setting-search">설정 검색</label><input id="setting-search" type="search" className="inp" placeholder="설정 찾기" value={vm.cardQuery} onChange={e=>vm.filterCards(vm.cardFilter,e.target.value)}/><label className="sr-only" htmlFor="setting-filter">설정 유형 필터</label><select id="setting-filter" className="inp" value={vm.cardFilter} onChange={e=>vm.filterCards(e.target.value as CardType|'all',vm.cardQuery)}><option value="all">모든 유형</option>{cardTypes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
    {editingOutside&&<div><p className="small muted">현재 편집 중 · 필터 조건 밖</p><button type="button" aria-label={`${setting.item.title||'이름 없는 설정'} ${labelOf(setting)}`} aria-current="true" onClick={()=>select(setting.item.id)}><SettingIcon setting={setting}/><span><strong>{setting.item.title||'이름 없는 설정'}</strong><small>{labelOf(setting)}</small></span></button></div>}
    <nav aria-label="설정 카드 목록">{vm.cardRows.map(s=><button type="button" key={s.item.id} aria-label={`${s.item.title||'이름 없는 설정'} ${labelOf(s)}`} aria-current={setting?.item.id===s.item.id?'true':undefined} onClick={()=>select(s.item.id)}><SettingIcon setting={s}/><span><strong>{s.item.title||'이름 없는 설정'}</strong><small>{labelOf(s)}</small><p>{s.item.text||'설명을 추가해 보세요.'}</p></span></button>)}</nav>
    {!vm.cardRows.length&&<p className="small muted">{world.settings.length?'조건에 맞는 설정이 없어요.':'설정을 추가해 시작해 보세요.'}</p>}
    {!!legacy.length&&<details className="world-legacy-list"><summary>기존 설정·관계 {legacy.length}개</summary><nav aria-label="기존 설정과 관계">{legacy.map(s=><button type="button" key={s.item.id} onClick={()=>select(s.item.id)}>{s.item.title||'이름 없는 설정'}<small>{labelOf(s)}</small></button>)}</nav></details>}
   </aside>
   {setting?<section className="world-writing-editor" aria-label="선택한 설정 편집"><button className="btn sm world-mobile-list" type="button" onClick={()=>vm.setCardDetail(false)}>설정 목록으로</button><div className="world-editor-heading">{cardTypeOf(setting.item)==='character'&&presentationPortrait(setting.item.title)?<img src={presentationPortrait(setting.item.title)} alt={`${setting.item.title} 인물 이미지`} width={72} height={72} style={{objectFit:'cover',borderRadius:12}}/>:<SettingIcon setting={setting}/>}<span>{labelOf(setting)}</span></div>
    <label className="field">설정 이름<input ref={field} className="inp world-name" required value={setting.item.title} maxLength={200} placeholder="이 설정의 이름은 무엇인가요?" onChange={e=>vm.update(setting.item.id,{title:e.target.value})}/></label>
    <label className="field">설명<textarea className="ta world-natural-input" rows={5} value={setting.item.text} maxLength={3000} placeholder="어떤 인물인가요? 무엇이 중요한 장소인가요? 떠오르는 내용을 자유롭게 적어 보세요." onChange={e=>vm.update(setting.item.id,{text:e.target.value})}/></label>
    {cardTypeOf(setting.item)==='character'&&<button className="btn sm world-relation-link" type="button" onClick={()=>vm.openRelations(setting.item.id)}>관계 연결로 이동</button>}
    <details className="world-additional" key={setting.item.id}><summary>상세 설정 · 선택</summary><div className="world-form-row"><label className="field">카드 유형<select className="inp" value={cardTypeOf(setting.item)} onChange={e=>vm.changeCardType(setting.item.id,e.target.value as CardType)}>{cardTypes.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}{['relation','review','note'].includes(cardTypeOf(setting.item))&&<option value={cardTypeOf(setting.item)}>{kinds[setting.item.kind]} · 기존 의미 유지</option>}</select></label><label className="field">설정 영역<select className="inp" value={setting.item.category} onChange={e=>vm.changeArea(setting.item.id,e.target.value as SettingItem['category'])}>{settingAreas.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div>
     <label className="field">태그 (쉼표로 구분)<input className="inp" value={setting.tags.join(',')} onChange={e=>vm.update(setting.item.id,{}, {tags:e.target.value.split(',')})} onBlur={()=>{const tags=studioLabelCleanup(setting.tags);if(tags)vm.update(setting.item.id,{}, {tags})}}/></label>
     <label className="field">별칭<input className="inp" value={setting.aliases?.join(',')??''} onChange={e=>vm.update(setting.item.id,{}, {aliases:e.target.value.split(',')})} onBlur={()=>{const aliases=studioLabelCleanup(setting.aliases);if(aliases)vm.update(setting.item.id,{}, {aliases})}}/></label><p id="world-alias-help" className="small muted">별칭은 쉼표로 구분하며 저장 시 다른 카드 정보와 함께 서버에 보존합니다.</p>
     <label className="field">내 분류<input className="inp" value={setting.userCategory} maxLength={50} onChange={e=>vm.update(setting.item.id,{}, {userCategory:e.target.value})}/></label>
     {setting.item.kind==='event'&&<label className="field">사건 시점<input className="inp" value={setting.item.timeText} onChange={e=>vm.update(setting.item.id,{timeText:e.target.value})}/></label>}
     {setting.item.kind==='relation'&&<><label className="field">기존 관계 유형<select className="inp" value={setting.item.predicate??'trusts'} onChange={e=>vm.update(setting.item.id,{predicate:e.target.value})}>{Object.entries(relationDefinitions).map(([id,r])=><option key={id} value={id}>{r.label}</option>)}</select></label>{(['subjectId','targetId'] as const).map((key,i)=><label className="field" key={key}>{i?'관계 대상':'관계 주체'}<select className="inp" value={setting.item[key]??''} onChange={e=>vm.update(setting.item.id,{[key]:e.target.value||null})}><option value="">선택하세요</option>{world.settings.filter(s=>s.item.kind==='entity').map(s=><option key={s.item.id} value={s.item.id}>{s.item.title}</option>)}</select></label>)}</>}
     <label className="world-consent"><input type="checkbox" role="switch" checked disabled aria-describedby="world-privacy-help"/>스포일러 숨기기</label><p id="world-privacy-help" className="small muted">카드는 소유자만 볼 수 있는 비공개 상태로 저장합니다. 발행·공개 및 이미지 첨부는 이 화면에서 지원하지 않습니다.</p>
    </details>
   </section>:<div className="world-empty"><h4>어떤 설정부터 시작할까요?</h4><p className="muted">인물이나 장소를 추가하고 이름부터 적어 보세요.</p></div>}
  </div>
 </fieldset>
}
function WritingReview({vm}:{vm:VM}){
 const world=vm.editing!,cards=world.settings.filter(s=>s.item.kind!=='relation'),relations=world.settings.filter(s=>s.item.kind==='relation')
 const name=(id:string|null)=>world.settings.find(s=>s.item.id===id)?.item.title||'이름 없는 설정'
 return <section className="world-review" aria-label="세계관 검토"><article className="world-review-intro"><div className="world-toolbar"><h4>{world.name||'이름 없는 세계관'}</h4><button className="btn sm" type="button" onClick={()=>vm.goStep('info')}>기본 정보 수정</button></div><p className="world-prose">{world.description||'설명은 나중에 추가해도 괜찮아요.'}</p></article>
  {vm.writingIssues.length>0&&<div className="world-error" role="alert"><h4>저장 전에 확인해 주세요</h4><ul>{vm.writingIssues.map((issue,i)=><li key={i}><button type="button" onClick={()=>issue.id?vm.editCard(issue.id):vm.goStep('info')}>{issue.message}</button></li>)}</ul></div>}
  <h4>설정 카드 {cards.length}개</h4>{cards.length?cards.map(s=><article className="world-review-item" key={s.item.id}><div><span className="small muted">{labelOf(s)}</span><h5>{s.item.title||'이름 없는 설정'}</h5><p className="world-prose">{s.item.text||'설명 없음'}</p></div><button className="btn sm" type="button" aria-label={`${s.item.title||'이름 없는 설정'} 수정`} onClick={()=>vm.editCard(s.item.id)}>수정</button></article>):<p className="muted">아직 등록한 설정이 없어요. 기본 정보만 저장해도 괜찮아요.</p>}
  <h4>관계 {relations.length}개</h4>{relations.length?relations.map(s=><article key={s.item.id} className="world-review-item"><div><h5>{name(s.item.subjectId)} → {name(s.item.targetId)}</h5><p className="world-prose">{relationLabel(s.item)}</p></div><button className="btn sm" type="button" onClick={()=>vm.editRelation(s.item.id)}>관계 수정</button></article>):<p className="muted">관계는 선택 사항이에요. 나중에 연결할 수 있습니다.</p>}
  <div className="world-save-actions"><p className="small muted">저장은 발행·공개와 다릅니다.</p><button className="btn pri" type="button" disabled={vm.busy||!vm.dirty||vm.writingIssues.length>0} onClick={vm.save}>세계관 저장</button></div>
 </section>
}

function Confirmed({vm,tab}:{vm:VM;tab:string}) {
 if(tab==='wiki'&&vm.saved)return <WorldWiki key={vm.saved.id} world={vm.saved}/>
 const items=vm.saved?.settings.map(s=>s.item)??[]
 if(tab==='timeline')return <section className="world-confirmed"><h3>저장된 시간선</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p><WorldTimeline items={items}/></section>
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 const rows=tab==='relations'?items.filter(i=>i.kind==='relation'):items
 return <section className="world-confirmed"><h3>{tab==='relations'?'저장된 현재 관계도':'저장된 설정집'}</h3><p className="small muted">저장한 설정만 보여드려요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p>{!rows.length?<p className="world-empty">아직 확정한 {tab==='relations'?'관계':'설정'}가 없습니다.</p>:rows.map(i=><article key={i.id}>
  <h4>{tab==='relations'?`${byId(i.subjectId)} → ${relationLabel(i)} → ${byId(i.targetId)}`:i.title}</h4><p className="world-prose">{i.text}</p>
 </article>)}</section>
}

function Analysis({vm}:{vm:VM}) {
 return <section className="world-analysis"><h3>AI 후보 검토</h3><p>현재 데모는 AI 모델/API와 연결되지 않았습니다. 후보를 생성하거나 서버에 반영하지 않습니다.</p><button type="button" className="btn" disabled>AI 분석 요청 · 미연결</button><button type="button" className="btn" onClick={()=>vm.setTool('write')}>작성으로 돌아가기</button><WorldCandidates analysis={vm.saved?.analysis??null}/></section>
}
