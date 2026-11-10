import { useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { MapControls, useMapCanvas } from './useMapCanvas'
import { mapEndpoint, presentationMapColors as palette, type MapNode, type MapLink, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import { presentationMapLayout } from '../viewmodel/presentationMapLayout'

export default function WorldMapCanvas({vm}:{vm:ReturnType<typeof useWorldMapViewModel>}) {
 const canvas=useMapCanvas(),{host,graph,width,reduced,paused,setSettled}=canvas
 const data=useMemo(()=>({nodes:presentationMapLayout(vm.graph.nodes),links:vm.graph.links.map(l=>({...l,source:mapEndpoint(l.source),target:mapEndpoint(l.target)}))}),[vm.graph])
 const linked=(l:MapLink)=>!!vm.selected&&(mapEndpoint(l.source)===vm.selected.id||mapEndpoint(l.target)===vm.selected.id)
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
   linkColor={l=>linked(l)?'#a9c6ffb0':vm.selected?'#7796ba12':'#7796ba45'} linkWidth={l=>linked(l)?1.6:.6} linkCurvature={l=>l.curve??.12}
   linkDirectionalArrowLength={l=>l.symmetric===false?5:0} linkDirectionalArrowRelPos={0.8}
   linkDirectionalParticles={l=>linked(l)&&!paused&&!reduced?2:0} linkDirectionalParticleWidth={2}
   onNodeClick={n=>vm.select(n.id)} onBackgroundClick={()=>vm.select(null)} onNodeDragEnd={n=>{n.fx=n.x;n.fy=n.y}}
   onEngineStop={()=>{setSettled(true);graph.current?.zoomToFit(reduced?0:600,65)}}/>
 </div><MapControls canvas={canvas} onReplay={replay}/></>
}
