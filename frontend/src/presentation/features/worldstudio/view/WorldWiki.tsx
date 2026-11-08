import { useEffect, useRef } from 'react'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import { presentationPortrait } from '../../../../app/presentationPortraits'
import { useWorldWikiViewModel, wikiGroupLabel } from '../viewmodel/useWorldWikiViewModel'
import './world-wiki.css'

export function WorldWiki({world}:{world:StudioWorld}) {
 const vm=useWorldWikiViewModel(world),heading=useRef<HTMLHeadingElement>(null),previous=useRef(vm.current?.item.id)
 useEffect(()=>{if(previous.current!==vm.current?.item.id){previous.current=vm.current?.item.id;heading.current?.focus({preventScroll:true})}},[vm.current?.item.id])
 if(!vm.current)return <p className="world-empty">아직 확정한 설정이 없습니다.</p>
 const {item,tags,userCategory}=vm.current
 const category=wikiGroupLabel(item)
 const portrait=item.entityType==='character'?presentationPortrait(item.title):undefined
 const sections=[['overview','개요'],...(vm.relations.length?[['relations','인물 관계']]:[]),...(vm.events.length?[['events','관련 사건']]:[]),...(vm.other.length?[['related','관련 문서']]:[]),...(item.evidence.length?[['sources','근거 기록']]:[])]
 const link=(id:string|null)=>{const doc=vm.documents.find(d=>d.item.id===id);return doc?<button type="button" className="world-wiki-link" onClick={()=>vm.open(doc.item.id)}>{doc.item.title||'이름 없는 설정'}</button>:<span className="muted">미지정</span>}
 return <section className="world-wiki" aria-label="설정집 WIKI">
  <header className="world-wiki-header"><div><h3>설정집 <span>WIKI</span></h3><p>세계관의 인물과 사건을 연결해 읽는 문서집</p></div><span className="small muted">확정 문서 {vm.documents.length}개</span></header>
  <div className="world-wiki-layout">
   <aside className="world-wiki-index"><label className="field">문서 검색<input className="inp" type="search" value={vm.query} onChange={e=>vm.setQuery(e.target.value)} placeholder="제목, 내용, 태그"/></label>
    <nav aria-label="위키 문서 목록">{vm.groups.map(group=><div key={group.id}><h4>{group.label}<span>{group.documents.length}</span></h4>{group.documents.map(doc=><button type="button" key={doc.item.id} aria-current={item.id===doc.item.id?'page':undefined} onClick={()=>vm.open(doc.item.id)}>{doc.item.title||'이름 없는 설정'}</button>)}</div>)}</nav>
    {!vm.groups.length&&<p className="small muted">일치하는 문서가 없습니다.</p>}
   </aside>
   <article className="world-wiki-document">
    <div className="world-wiki-breadcrumb"><span>{world.name} / {category}</span><button type="button" className="btn sm" disabled={!vm.canGoBack} onClick={vm.back}>이전 문서</button></div>
    <h3 ref={heading} tabIndex={-1} className="world-wiki-title">{item.title||'이름 없는 설정'}</h3>
    <div className="world-wiki-categories">분류: <span>{category}</span>{userCategory!=='설정'&&<span>{userCategory}</span>}{tags.map(tag=><span key={tag}>{tag}</span>)}</div>
    <div className="world-wiki-body">
     <div className="world-wiki-main">
      <nav className="world-wiki-toc" aria-label="문서 목차"><strong>목차</strong><ol>{sections.map(([id,label])=><li key={id}><a href={`#wiki-${id}`}>{label}</a></li>)}</ol></nav>
      <section id="wiki-overview" aria-label="개요"><h4><span>1.</span> 개요</h4><p className="world-prose">{item.text||'아직 작성한 설명이 없습니다.'}</p>{item.condition&&<p>적용 조건: {item.condition}</p>}{item.afterId&&<p>앞선 사건: {link(item.afterId)}</p>}</section>
      {!!vm.relations.length&&<section id="wiki-relations" aria-label="인물 관계"><h4><span>{sections.findIndex(s=>s[0]==='relations')+1}.</span> 인물 관계</h4><div className="world-wiki-table-scroll"><table><thead><tr><th>인물</th><th>관계</th><th>대상</th></tr></thead><tbody>{vm.relations.map(({item:r})=><tr key={r.id}><td>{link(r.subjectId)}</td><td>{relationLabel(r)}</td><td>{link(r.targetId)}</td></tr>)}</tbody></table></div>{vm.relations.map(({item:r})=><p className="world-wiki-note" key={r.id}>{r.text}</p>)}</section>}
      {!!vm.events.length&&<section id="wiki-events" aria-label="관련 사건"><h4><span>{sections.findIndex(s=>s[0]==='events')+1}.</span> 관련 사건</h4>{vm.events.map(({item:event})=><div className="world-wiki-entry" key={event.id}><small>{event.timeText||'시점 미지정'}</small><div>{link(event.id)}<p>{event.text}</p></div></div>)}</section>}
      {!!vm.other.length&&<section id="wiki-related" aria-label="관련 문서"><h4><span>{sections.findIndex(s=>s[0]==='related')+1}.</span> 관련 문서</h4><ul>{vm.other.map(({item:doc})=><li key={doc.id}>{link(doc.id)}</li>)}</ul></section>}
      {!!item.evidence.length&&<section id="wiki-sources" aria-label="근거 기록"><h4><span>{sections.findIndex(s=>s[0]==='sources')+1}.</span> 근거 기록</h4>{item.evidence.map((source,i)=><blockquote key={i}>{source.quote}<cite>{source.sourceId}</cite></blockquote>)}</section>}
     </div>
     <aside className="world-wiki-infobox" aria-label="문서 정보"><div className="world-wiki-info-title">{item.title||'이름 없는 설정'}</div>{portrait&&<img src={portrait} alt={`${item.title} 인물 이미지`}/>}<dl><div><dt>세계관</dt><dd>{world.name}</dd></div><div><dt>분류</dt><dd>{category}</dd></div>{item.timeText&&<div><dt>시점</dt><dd>{item.timeText}</dd></div>}<div><dt>상태</dt><dd>작가 확정</dd></div><div><dt>문서 연결</dt><dd>{vm.other.length+vm.events.length}개</dd></div></dl></aside>
    </div>
    <footer className="world-wiki-footer">저장한 세계관 기준 · 작성 중 변경과 AI 후보는 포함하지 않습니다.</footer>
   </article>
  </div>
 </section>
}
