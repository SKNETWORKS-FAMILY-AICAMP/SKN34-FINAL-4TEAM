import { useEffect, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { mapColors, mapEndpoint, type MapNode, type MapLink, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

export default function WorldMapCanvas({vm}:{vm:ReturnType<typeof useWorldMapViewModel>}) {
 const host=useRef<HTMLDivElement>(null),graph=useRef<ForceGraphMethods<MapNode,MapLink>>(undefined)
 const [width,setWidth]=useState(500),[reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false)
 const [paused,setPaused]=useState(reduced),[settled,setSettled]=useState(false)
 useEffect(()=>{const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!media)return;const change=()=>{setReduced(media.matches);if(media.matches)setPaused(true)};media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
 useEffect(()=>{if(!host.current)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(host.current);return()=>observer.disconnect()},[])
 useEffect(()=>{graph.current?.zoomToFit(0,40)},[width])
 const linked=(l:MapLink)=>!!vm.selected&&(mapEndpoint(l.source)===vm.selected.id||mapEndpoint(l.target)===vm.selected.id)
 const replay=()=>{
  for(const [i,n] of vm.graph.nodes.entries()){n.fx=undefined;n.fy=undefined;n.x=Math.cos(i*2.4)*15;n.y=Math.sin(i*2.4)*15;n.vx=0;n.vy=0}
  setPaused(false);setSettled(false);graph.current?.resumeAnimation();graph.current?.centerAt(0,0,0);graph.current?.zoom(1,0);graph.current?.d3ReheatSimulation()
 }
 return <><p className="small muted" role="status">{paused?'움직임 멈춤':settled?'배치 완료':'연결을 따라 펼쳐지는 중'}</p><div ref={host} className="world-map-canvas">
  <ForceGraph2D<MapNode,MapLink> ref={graph} graphData={vm.graph} width={width} height={460} backgroundColor="rgba(0,0,0,0)"
   cooldownTicks={paused?0:220} warmupTicks={reduced?220:0} nodeLabel={()=>''} nodeRelSize={6}
   nodeCanvasObject={(node,ctx,scale)=>{
    const active=vm.visible.has(node.id)&&(!vm.selected||vm.neighbors.has(node.id)),x=node.x??0,y=node.y??0
    ctx.globalAlpha=active?1:.15;ctx.beginPath();ctx.arc(x,y,6,0,2*Math.PI);ctx.fillStyle=mapColors[node.kind];ctx.fill()
    if(vm.selected?.id===node.id){ctx.beginPath();ctx.arc(x,y,6+4/scale,0,2*Math.PI);ctx.lineWidth=2/scale;ctx.strokeStyle=mapColors[node.kind];ctx.stroke()}
    if(active){ctx.font=`${12/scale}px "Malgun Gothic",sans-serif`;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=getComputedStyle(ctx.canvas).getPropertyValue('--ink')||'#191a1f';ctx.fillText(node.name,x,y+6+4/scale)}ctx.globalAlpha=1
   }}
   nodePointerAreaPaint={(n,color,ctx)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x??0,n.y??0,11,0,2*Math.PI);ctx.fill()}}
   linkColor={l=>linked(l)?'#9472e2':'#a5a7b780'} linkWidth={l=>linked(l)?1.8:.7}
   linkDirectionalParticles={l=>linked(l)&&!paused&&!reduced?2:0} linkDirectionalParticleWidth={2}
   onNodeClick={n=>vm.select(n.id)} onBackgroundClick={()=>vm.select(null)} onNodeDragEnd={n=>{n.fx=n.x;n.fy=n.y}}
   onEngineStop={()=>{setSettled(true);if(!paused)graph.current?.zoomToFit(reduced?0:400,40)}}/>
 </div><div className="world-map-controls">
  <button type="button" className="btn pri sm" onClick={replay}>다시 펼치기</button>
  <button type="button" className="btn sm" onClick={()=>{if(paused){setSettled(false);graph.current?.d3ReheatSimulation()}setPaused(!paused)}}>{paused?'움직임 재개':'움직임 멈추기'}</button>
  <button type="button" className="btn sm" onClick={()=>graph.current?.zoomToFit(reduced?0:350,40)}>전체 보기</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()*1.25,reduced?0:200)}} aria-label="지도 확대">확대 +</button>
  <button type="button" className="btn sm" onClick={()=>{const g=graph.current;if(g)g.zoom(g.zoom()/1.25,reduced?0:200)}} aria-label="지도 축소">축소 −</button>
 </div></>
}
