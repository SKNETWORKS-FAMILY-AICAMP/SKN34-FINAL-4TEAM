import { presentationPortrait } from '../../../../app/presentationPortraits'
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { mapEndpoint, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

/** `onPick`은 카드 본문을 눌렀을 때(드래그 없이) 부르고, 없으면 `onSelect`를 부른다. 관계 편집은 본문 누르기를 관계 연결에 쓰고 '정보 편집' 버튼만 `onSelect`로 남긴다. */
type Actions={busy:boolean;selectedRelations:string[];targetSource:string|null;readOnly?:boolean;onSelect:(id:string)=>void;onConnect:(id:string)=>void;onRelation:(id:string)=>void;onPick?:(id:string)=>void}
type Point={x:number;y:number}
export default function CharacterCards({vm,editing}:{vm:ReturnType<typeof useWorldMapViewModel>;editing:Actions}) {
 const host=useRef<HTMLDivElement>(null),cards=useRef(new Map<string,HTMLDivElement>())
 const drag=useRef<{id:string;start:Point;position:Point;moved:boolean}|null>(null)
 const [width,setWidth]=useState(700),[manual,setManual]=useState(()=>new Map<string,Point>())
 const marker=useId().replaceAll(':','')
 const cardHeight=150,gap=144,columns=Math.max(1,Math.min(vm.graph.nodes.length||1,Math.floor((width-32+gap)/(180+gap))))
 const cardWidth=Math.max(140,Math.min(200,(width-32-(columns-1)*gap)/columns))
 const layout=useMemo(()=>new Map(vm.graph.nodes.map((n,i)=>[n.id,{x:(width-columns*cardWidth-(columns-1)*gap)/2+(i%columns)*(cardWidth+gap),y:24+Math.floor(i/columns)*(cardHeight+gap)}])),[vm.graph.nodes,width,columns,cardWidth])
 const at=(id:string)=>manual.get(id)??layout.get(id)!
 const boardWidth=Math.max(width,...vm.graph.nodes.map(n=>at(n.id).x+cardWidth+20)),boardHeight=Math.max(360,...vm.graph.nodes.map(n=>at(n.id).y+cardHeight+24))
 useEffect(()=>{if(!host.current||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(host.current);return()=>observer.disconnect()},[])
 const selectedId=vm.selected?.id
 useEffect(()=>{if(selectedId)cards.current.get(selectedId)?.scrollIntoView?.({block:'nearest',inline:'nearest'})},[selectedId])
 const start=(id:string,e:PointerEvent<HTMLDivElement>)=>{
  if(editing.busy||(e.target instanceof Element&&e.target.closest('button')))return
  drag.current={id,start:{x:e.clientX,y:e.clientY},position:at(id),moved:false};e.currentTarget.setPointerCapture?.(e.pointerId)
 }
 const move=(e:PointerEvent<HTMLDivElement>)=>{
  const d=drag.current;if(!d)return
  const dx=e.clientX-d.start.x,dy=e.clientY-d.start.y
  if(Math.hypot(dx,dy)<4&&!d.moved)return
  d.moved=true
  if(editing.targetSource)return // 상대를 고르는 중에는 카드를 끌지 않고 누르기만 받는다
  setManual(old=>new Map(old).set(d.id,{x:Math.max(8,d.position.x+dx),y:Math.max(12,d.position.y+dy)}))
 }
 const stop=(e:PointerEvent<HTMLDivElement>)=>{const d=drag.current;drag.current=null;e.currentTarget.releasePointerCapture?.(e.pointerId);if(d&&!d.moved)(editing.onPick??editing.onSelect)(d.id)}
 const names=new Map(vm.graph.nodes.map(n=>[n.id,n.name])),title=(id:string)=>names.get(id)??'인물'
 const subject=vm.graph.nodes.some(n=>n.kind!=='인물')?'설정':'인물'
 return <div ref={host} className="relationship-cards-scroll" role="group" aria-label={`${subject} 카드 그래프`}>
  <div className="relationship-cards-board" style={{width:boardWidth,height:boardHeight}}>
   <svg width={boardWidth} height={boardHeight} className="relationship-card-edges" role="group" aria-label={`${subject} 사이 관계선`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge,var(--pri-ink))"/></marker></defs>
    {vm.graph.links.map((l,i)=>{
     const source=mapEndpoint(l.source),target=mapEndpoint(l.target),a=at(source),b=at(target)
     if(!a||!b)return null
     const ax=a.x+cardWidth/2,ay=a.y+cardHeight/2,bx=b.x+cardWidth/2,by=b.y+cardHeight/2,dx=bx-ax,dy=by-ay
     const factor=Math.min((cardWidth/2+10)/Math.max(1,Math.abs(dx)),(cardHeight/2+10)/Math.max(1,Math.abs(dy)))
     const sx=ax+dx*factor,sy=ay+dy*factor,tx=bx-dx*factor,ty=by-dy*factor,c=l.curve??0
     const cx=(ax+bx)/2+dy*c,cy=(ay+by)/2-dx*c,d=`M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`
     const active=!!l.id&&editing.selectedRelations.includes(l.id),color=active?'var(--edge-active,var(--pri))':l.emotion?'var(--edge-emotion,var(--acc-ink))':'var(--edge,var(--pri-ink))'
     const label=`${editing.readOnly?'관계선 보기':'관계선 편집'}: ${title(source)} · ${title(target)} · ${l.fullLabel??l.label}`
     return <g key={l.id??i}>
      <path d={d} fill="none" stroke={color} strokeWidth={active?3:2} strokeDasharray={l.emotion?'6 4':undefined} markerEnd={l.symmetric?undefined:`url(#${marker})`}/>
      <path d={d} className="relationship-edge-hit" fill="none" stroke="transparent" strokeWidth={16} role="button" tabIndex={-1} aria-label={label} onClick={()=>{if(l.id&&!editing.busy)editing.onRelation(l.id)}}><title>{l.fullLabel??l.label}</title></path>
      <text x={(sx+2*cx+tx)/4} y={(sy+2*cy+ty)/4-7} textAnchor="middle" fill={color} className="relationship-edge-label">{l.label}</text>
     </g>
    })}
   </svg>
   {vm.graph.nodes.map(n=>{const p=at(n.id),portrait=presentationPortrait(n.name),target=!!editing.targetSource&&n.id!==editing.targetSource,selected=vm.selected?.id===n.id
    return <div key={n.id} role="group" data-id={n.id} aria-current={selected||undefined} aria-label={`${n.name} ${n.kind} 카드`} ref={el=>{if(el)cards.current.set(n.id,el);else cards.current.delete(n.id)}} className={'relationship-character-card'+(selected?' selected':'')+(target?' target':'')+(!vm.visible.has(n.id)?' dim':'')} style={{width:cardWidth,height:cardHeight,transform:`translate(${p.x}px, ${p.y}px)`}} onPointerDown={e=>start(n.id,e)} onPointerMove={move} onPointerUp={stop} onPointerCancel={()=>{drag.current=null}}>
     <h4 title={n.name}>{portrait&&<img src={portrait} alt="" width={36} height={36}/>}{n.name}</h4><p title={n.text}>{n.text||'소개를 입력할 수 있어요.'}</p>
     <div><button type="button" className="btn sm" aria-label={`${n.name} ${editing.readOnly?'상세 보기':'정보 편집'}`} disabled={editing.busy||!!editing.targetSource} onClick={()=>editing.onSelect(n.id)}>{editing.readOnly?'상세 보기':'정보 편집'}</button>
      {!editing.readOnly&&(editing.targetSource?<button type="button" className="btn pri sm" aria-label={`${n.name} 상대 선택`} disabled={editing.busy||n.id===editing.targetSource||n.unnamed} onClick={()=>editing.onSelect(n.id)}>상대 선택</button>:<button type="button" className="btn sm" aria-label={`${n.name} 관계 연결`} disabled={editing.busy||n.unnamed} onClick={()=>editing.onConnect(n.id)}>관계 연결</button>)}
     </div>
    </div>
   })}
  </div>
 </div>
}
