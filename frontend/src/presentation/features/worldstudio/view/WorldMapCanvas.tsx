import ForceGraph2D from 'react-force-graph-2d'
import { MapControls, useMapCanvas } from './useMapCanvas'
import { mapColors, mapEndpoint, type MapNode, type MapLink, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

export default function WorldMapCanvas({vm}:{vm:ReturnType<typeof useWorldMapViewModel>}) {
 const canvas=useMapCanvas(),{host,graph,width,reduced,paused,setPaused,setSettled}=canvas
 const linked=(l:MapLink)=>!!vm.selected&&(mapEndpoint(l.source)===vm.selected.id||mapEndpoint(l.target)===vm.selected.id)
 const replay=()=>{
  for(const [i,n] of vm.graph.nodes.entries()){n.fx=undefined;n.fy=undefined;n.x=Math.cos(i*2.4)*15;n.y=Math.sin(i*2.4)*15;n.vx=0;n.vy=0}
  setPaused(false);setSettled(false);graph.current?.resumeAnimation();graph.current?.centerAt(0,0,0);graph.current?.zoom(1,0);graph.current?.d3ReheatSimulation()
 }
 return <><p className="small muted" role="status">{canvas.status}</p><div ref={host} className="world-map-canvas">
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
   linkCurvature={l=>l.curve??0} linkDirectionalArrowLength={l=>l.symmetric===false?5:0} linkDirectionalArrowRelPos={0.8}
   linkDirectionalParticles={l=>linked(l)&&!paused&&!reduced?2:0} linkDirectionalParticleWidth={2}
   onNodeClick={n=>vm.select(n.id)} onBackgroundClick={()=>vm.select(null)} onNodeDragEnd={n=>{n.fx=n.x;n.fy=n.y}}
   onEngineStop={()=>{setSettled(true);if(!paused)graph.current?.zoomToFit(reduced?0:400,40)}}/>
 </div><MapControls canvas={canvas} onReplay={replay}/></>
}
