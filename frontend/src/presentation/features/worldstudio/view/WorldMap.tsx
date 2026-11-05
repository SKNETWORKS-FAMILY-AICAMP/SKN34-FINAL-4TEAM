import {buildCharacterMap} from '../viewmodel/characterMap'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { mapColors, buildWorldMap, useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import './world-map.css'

const WorldMapCanvas=lazy(()=>import('./WorldMapCanvas'))
export class MapBoundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<p role="alert" className="world-map-empty">지도를 표시하지 못했습니다. 설정 목록에서 내용을 확인해 주세요.</p>:this.props.children}
}

export function WorldMap({world,charactersOnly=false}:{world:StudioWorld;charactersOnly?:boolean}) {
 const vm=useWorldMapViewModel(world.settings,charactersOnly?buildCharacterMap:buildWorldMap)
 const title=charactersOnly?'인물 관계도 · 2D':'전체 세계관 지도'
 return <section className="world-map" aria-label={title}>
  <div className="world-map-intro"><h3>{title}</h3><p>저장한 설정의 연결을 살펴보세요. 작성 중 변경과 AI 후보는 포함하지 않습니다.</p></div>
  {!vm.graph.nodes.length?<p className="world-map-empty">저장된 설정이 없습니다.</p>:<div className="world-map-layout">
   <aside className="world-map-search"><h4>설정 탐색</h4><label className="field">설정 검색<input type="search" className="inp" value={vm.query} onChange={e=>vm.setQuery(e.target.value)} placeholder="이름, 내용, 태그"/></label>
    <div className="world-map-filters" role="group" aria-label="설정 종류">{(['전체',...Object.keys(mapColors)] as const).map(k=><button key={k} type="button" aria-pressed={vm.kind===k} onClick={()=>vm.setKind(k as typeof vm.kind)}>{k}</button>)}</div>
    <p role="status" className="small muted">검색 결과 {vm.results.length}개 · 전체 {vm.graph.nodes.length}개</p>
    <nav aria-label="지도 설정 목록">{vm.results.map(n=><button key={n.id} type="button" aria-label={`${n.name} ${n.kind}`} aria-pressed={vm.selected?.id===n.id} onClick={()=>vm.select(n.id)}><i style={{background:mapColors[n.kind]}}/>{n.name}<small>{n.kind}</small></button>)}</nav>
    {!vm.results.length&&<div><p>일치하는 설정이 없습니다.</p><button className="btn sm" onClick={()=>{vm.setQuery('');vm.setKind('전체')}}>검색 조건 초기화</button></div>}
   </aside>
   <div className="world-map-center"><p className="small muted">{vm.graph.nodes.length}개 설정 · {vm.graph.links.length}개 연결</p>
    <MapBoundary><Suspense fallback={<p role="status">지도를 불러오고 있습니다.</p>}><WorldMapCanvas vm={vm}/></Suspense></MapBoundary>
    <div className="world-map-legend">{Object.entries(mapColors).map(([name,color])=><span key={name}><i style={{background:color}}/>{name}</span>)}</div>
    <p className="small muted">노드 선택: 상세 보기 · 드래그: 위치 이동 · 휠: 확대·축소. 위치는 저장되지 않습니다.</p>
    {!!vm.graph.missingLinks&&<p role="status" className="small">현재 설정에서 찾을 수 없는 연결 {vm.graph.missingLinks}개는 표시하지 않았습니다.</p>}
   </div>
   <aside className="world-map-detail" aria-label="선택한 설정"><h4>설정 살펴보기</h4>{vm.selected?<>
    <div className="world-map-detail-head"><span className="chip">{vm.selected.kind}</span><button type="button" className="btn sm" onClick={()=>vm.select(null)}>선택 해제</button></div>
    <h3>{vm.selected.name}</h3><p className="world-prose">{vm.selected.text||'아직 작성한 설명이 없습니다.'}</p><p className="small muted">{vm.selected.tags.map(t=>'#'+t).join(' ')}</p>
    <h4>연결된 설정</h4>{vm.connections.length?vm.connections.map((c,i)=><button className="world-map-connection" key={`${c.node.id}-${i}`} onClick={()=>vm.select(c.node.id)}><span>{c.node.name}</span><small>{c.label}</small></button>):<p className="muted">명시적으로 연결된 설정이 없습니다.</p>}
   </>:<p className="muted">지도 위의 점이나 설정 목록을 선택하면 연결된 설정을 함께 확인할 수 있어요.</p>}</aside>
  </div>}
 </section>
}
