import { useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { MapControls, useMapCanvas } from './useMapCanvas'
import { mapEndpoint, type MapNode, type MapLink, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

export default function WorldMapCanvas({vm}:{vm:ReturnType<typeof useWorldMapViewModel>}) {
 const canvas=useMapCanvas(),{host,graph,width,reduced,paused,setSettled}=canvas
 const palette={인물:'#67caff',장소:'#6ce3cb',조직:'#ffca83',규칙:'#c0abff',사건:'#f0a0cf',관계:'#b9a0ed',설정:'#a5b8d8'}
 const data=useMemo(()=>{
  const people=vm.graph.nodes.filter(n=>n.kind==='인물'),others=vm.graph.nodes.filter(n=>n.kind!=='인물')
  const nodes=vm.graph.nodes.map(node=>{
   const person=node.kind==='인물',i=(person?people:others).findIndex(n=>n.id===node.id),count=(person?people:others).length
   const angle=i*Math.PI*2/Math.max(count,1)-Math.PI/2
   const x=person?(i-(count-1)/2)*160:Math.cos(angle)*(360+(i%2)*65)
   const y=person?(i%2?55:-40):Math.sin(angle)*(210+(i%2)*50)
   return {...node,x,y,fx:x,fy:y}
  })
  return {nodes,links:vm.graph.links.map(l=>({...l,source:mapEndpoint(l.source),target:mapEndpoint(l.target)}))}
 },[vm.graph])
 const linked=(l:MapLink)=>!!vm.selected&&vm.neighbors.has(mapEndpoint(l.source))&&vm.neighbors.has(mapEndpoint(l.target))
 const replay=()=>{
  vm.select(null);graph.current?.zoom(.2,0);graph.current?.zoomToFit(reduced?0:900,65)
 }
 return <><p className="small muted" role="status">{canvas.status}</p><div ref={host} className="world-map-canvas">
  <ForceGraph2D<MapNode,MapLink> ref={graph} graphData={data} width={width} height={560} backgroundColor="rgba(0,0,0,0)"
   cooldownTicks={1} nodeLabel={()=>''} nodeRelSize={8}
   nodeCanvasObject={(node,ctx,scale)=>{
    const active=vm.visible.has(node.id)&&(!vm.selected||vm.neighbors.has(node.id)),x=node.x??0,y=node.y??0
    const radius=node.kind==='인물'?10:5
    ctx.globalAlpha=active?1:.22;ctx.filter=active?'none':`blur(${3/scale}px)`;ctx.shadowColor=palette[node.kind];ctx.shadowBlur=active?18:0
    ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fillStyle=palette[node.kind];ctx.fill();ctx.shadowBlur=0
    if(vm.selected?.id===node.id){ctx.beginPath();ctx.arc(x,y,radius+6/scale,0,2*Math.PI);ctx.lineWidth=1.5/scale;ctx.strokeStyle=palette[node.kind];ctx.stroke()}
    ctx.filter='none';ctx.globalAlpha=active?1:.55
    ctx.font=`${node.kind==='인물'?'600 ':''}${node.kind==='인물'?15/scale:11/scale}px "Malgun Gothic",sans-serif`;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#edf2ff';ctx.fillText(node.name.length>16?node.name.slice(0,15)+'…':node.name,x,y+radius+7/scale);ctx.globalAlpha=1;ctx.filter='none'
   }}
   nodePointerAreaPaint={(n,color,ctx)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(n.x??0,n.y??0,11,0,2*Math.PI);ctx.fill()}}
   linkColor={l=>linked(l)?'#a9c6ffb0':vm.selected?'#7796ba12':'#7796ba45'} linkWidth={l=>linked(l)?1.6:.6} linkCurvature={.12}
   linkDirectionalParticles={l=>linked(l)&&!paused&&!reduced?2:0} linkDirectionalParticleWidth={2}
   onNodeClick={n=>vm.select(n.id)} onBackgroundClick={()=>vm.select(null)} onNodeDragEnd={n=>{n.fx=n.x;n.fy=n.y}}
   onEngineStop={()=>{setSettled(true);graph.current?.zoomToFit(reduced?0:600,65)}}/>
 </div><MapControls canvas={canvas} onReplay={replay}/></>
}
