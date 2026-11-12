import { useEffect, useRef, useState } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import { pannedCenter, type PanDirection } from './mapPan'

/** 공개 세계관의 지도(`/worlds`)와 상세 그래프 캔버스가 자기 노드·링크 타입으로 함께 쓰는 훅과 컨트롤이다. */
export function useMapCanvas<N,L>() {
 const host=useRef<HTMLDivElement>(null),graph=useRef<ForceGraphMethods<N,L>>(undefined)
 const [width,setWidth]=useState(500),[reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false)
 const [paused,setPaused]=useState(reduced),[settled,setSettled]=useState(false)
 useEffect(()=>{const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;const change=()=>{setReduced(media.matches);if(media.matches)setPaused(true)};media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(host.current);return()=>observer.disconnect()},[])
 useEffect(()=>{graph.current?.zoomToFit(0,40)},[width])
 return {host,graph,width,reduced,paused,setPaused,settled,setSettled,status:paused?'움직임 멈춤':settled?'배치 완료':'연결을 따라 펼쳐지는 중'}
}

/** 방향 이동 버튼: 방향·접근 이름·화살표 선(24 격자, 굵기 2, 둥근 끝. 다른 선 아이콘과 같은 규칙이다). */
const PAN:[PanDirection,string,string][]=[['left','왼쪽으로 이동','M15 5l-7 7 7 7'],['up','위로 이동','M5 15l7-7 7 7'],['down','아래로 이동','M5 9l7 7 7-7'],['right','오른쪽으로 이동','M9 5l7 7-7 7']]

/**
 * 캔버스 아래 컨트롤. 방향 이동 묶음(`.map-pan`)은 누를 때마다 보이는 영역의 4분의 1만큼 화면을 옮긴다(`pannedCenter`, 동작 줄이기면 전환 없이).
 * 끌어서 옮길 수 없는 터치 기기와 키보드로 컨트롤에 들어온 동안에만 보이도록 worlds.css가 정한다.
 */
export function MapControls<N,L>({canvas:{host,graph,reduced,paused,setPaused,setSettled},onReplay}:{canvas:ReturnType<typeof useMapCanvas<N,L>>;onReplay:()=>void}) {
 const pan=(direction:PanDirection)=>{
  const g=graph.current,box=host.current
  if(!g||!box)return
  const {x,y}=pannedCenter(g.centerAt(),direction,{width:box.clientWidth,height:box.clientHeight,zoom:g.zoom()})
  g.centerAt(x,y,reduced?0:200)
 }
 return <div className="world-map-controls">
  <button type="button" className="btn pri sm" onClick={onReplay}>다시 펼치기</button>
  <button type="button" className="btn sm" onClick={()=>{if(paused){setSettled(false);graph.current?.d3ReheatSimulation()}setPaused(!paused)}}>{paused?'움직임 재개':'움직임 멈추기'}</button>
  <button type="button" className="btn sm" onClick={()=>graph.current?.zoomToFit(reduced?0:350,40)}>전체 보기</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()*1.25,reduced?0:200)}} aria-label="지도 확대">확대 +</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()/1.25,reduced?0:200)}} aria-label="지도 축소">축소 −</button>
  <div className="map-pan" role="group" aria-label="지도 이동">
   {PAN.map(([direction,label,d])=><button key={direction} type="button" className="btn sm" aria-label={label} title={label} onClick={()=>pan(direction)}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>
   </button>)}
  </div>
 </div>
}
