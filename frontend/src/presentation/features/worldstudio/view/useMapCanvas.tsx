import { useEffect, useRef, useState } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { MapLink, MapNode } from '../viewmodel/useWorldMapViewModel'

export function useMapCanvas() {
 const host=useRef<HTMLDivElement>(null),graph=useRef<ForceGraphMethods<MapNode,MapLink>>(undefined)
 const [width,setWidth]=useState(500),[reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false)
 const [paused,setPaused]=useState(reduced),[settled,setSettled]=useState(false)
 useEffect(()=>{const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;const change=()=>{setReduced(media.matches);if(media.matches)setPaused(true)};media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(host.current);return()=>observer.disconnect()},[])
 useEffect(()=>{graph.current?.zoomToFit(0,40)},[width])
 return {host,graph,width,reduced,paused,setPaused,settled,setSettled,status:paused?'움직임 멈춤':settled?'배치 완료':'연결을 따라 펼쳐지는 중'}
}

export function MapControls({canvas:{graph,reduced,paused,setPaused,setSettled},onReplay}:{canvas:ReturnType<typeof useMapCanvas>;onReplay:()=>void}) {
 return <div className="world-map-controls">
  <button type="button" className="btn pri sm" onClick={onReplay}>다시 펼치기</button>
  <button type="button" className="btn sm" onClick={()=>{if(paused){setSettled(false);graph.current?.d3ReheatSimulation()}setPaused(!paused)}}>{paused?'움직임 재개':'움직임 멈추기'}</button>
  <button type="button" className="btn sm" onClick={()=>graph.current?.zoomToFit(reduced?0:350,40)}>전체 보기</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()*1.25,reduced?0:200)}} aria-label="지도 확대">확대 +</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()/1.25,reduced?0:200)}} aria-label="지도 축소">축소 −</button>
 </div>
}
