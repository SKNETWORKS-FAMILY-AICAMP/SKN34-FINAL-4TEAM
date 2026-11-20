import { presentationPortrait } from '../../../../app/presentationPortraits'
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { CARD_COLORS, CARD_KIND } from '../../../shared/worldBoard'
import { labelAngle, ringLayout } from '../viewmodel/characterMap'
import { mapEndpoint, type useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'

/** `onPick`은 카드 본문을 눌렀을 때(드래그 없이) 부르고, 없으면 `onSelect`를 부른다. 관계 편집은 본문 누르기를 관계 연결에 쓰고 '정보 편집' 버튼만 `onSelect`로 남긴다. */
type Actions={busy:boolean;selectedRelations:string[];targetSource:string|null;readOnly?:boolean;onSelect:(id:string)=>void;onConnect:(id:string)=>void;onRelation:(id:string)=>void;onPick?:(id:string)=>void}
type Point={x:number;y:number}
/**
 * 카드 그래프. `center`(중심 카드 id)가 있으면 그 카드를 보드 가운데에 두고 이웃(`vm.graph.nodes`의 나머지)을 둘레 원 위에 놓는다(`ringLayout`, 선이 서로 교차하지 않는 별 모양). 없으면 모든 카드를 격자에 깐다.
 * 관계선 라벨(`<text>`)은 중심 보기에서는 중심 카드에 닿는 선에, 전체 보기에서는 마우스를 올리거나 초점을 둔 선(키보드는 카드 버튼에 초점이 있는 카드에 닿는 선)에만 그리고, 나머지 선은 `<title>` 툴팁·누르는 영역의 이름으로만 읽힌다(겹친 선의 라벨이 서로 가리지 않게).
 */
export default function CharacterCards({vm,editing,center}:{vm:ReturnType<typeof useWorldMapViewModel>;editing:Actions;center?:string}) {
 const host=useRef<HTMLDivElement>(null),cards=useRef(new Map<string,HTMLDivElement>())
 const drag=useRef<{id:string;start:Point;position:Point;moved:boolean}|null>(null)
 const [width,setWidth]=useState(700),[manual,setManual]=useState(()=>new Map<string,Point>())
 // 중심 카드가 바뀌면 끌어 둔 위치를 버린다(다른 중심의 둘레에 옛 위치가 남지 않게).
 const [shownCenter,setShownCenter]=useState(center)
 if(shownCenter!==center){setShownCenter(center);setManual(new Map())}
 const marker=useId().replaceAll(':','')
 const cardHeight=150,gap=144,columns=Math.max(1,Math.min(vm.graph.nodes.length||1,Math.floor((width-32+gap)/(180+gap))))
 const cardWidth=Math.max(140,Math.min(200,(width-32-(columns-1)*gap)/columns))
 const others=vm.graph.nodes.filter(n=>n.id!==center)
 // 배치 크기는 중심 카드·이웃 수·폭이 바뀔 때만 다시 만든다(부모가 다시 그릴 때마다 nodes가 새 배열이라 그 배열을 열쇠로 쓰면 매번 새로 만들어진다).
 const ring=useMemo(()=>center?ringLayout(others.length,width,cardWidth,cardHeight):null,[center,others.length,width,cardWidth])
 const layout=useMemo(()=>ring
  ?new Map<string,Point>([[center!,ring.center],...others.map((n,i)=>[n.id,ring.ring[i]] as [string,Point])])
  :new Map(vm.graph.nodes.map((n,i)=>[n.id,{x:(width-columns*cardWidth-(columns-1)*gap)/2+(i%columns)*(cardWidth+gap),y:24+Math.floor(i/columns)*(cardHeight+gap)}])),[vm.graph.nodes,width,columns,cardWidth,ring,center,others])
 const at=(id:string)=>manual.get(id)??layout.get(id)!
 // 원이 호스트 폭보다 넓으면 카드째 줄인다(ring.scale<1): 카드 한 장의 실제 크기는 cw×ch다. 격자 배치는 늘 원래 크기다.
 const k=ring?.scale??1,cw=cardWidth*k,ch=cardHeight*k
 const boardWidth=Math.ceil(Math.max(ring?.width??width,...vm.graph.nodes.map(n=>at(n.id).x+cw+20))-1e-6),boardHeight=Math.ceil(Math.max(ring?.height??360,...vm.graph.nodes.map(n=>at(n.id).y+ch+24))-1e-6)
 useEffect(()=>{if(!host.current||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));observer.observe(host.current);return()=>observer.disconnect()},[])
 const selectedId=vm.selected?.id
 useEffect(()=>{if(selectedId)cards.current.get(selectedId)?.scrollIntoView?.({block:'nearest',inline:'nearest'})},[selectedId])
 // 중심 카드 보기에서 원이 상자보다 크면 가운데(중심 카드)가 먼저 보이게 스크롤한다. 자동 배치 크기(ring)가 바뀔 때만이라 부모가 다시 그리거나 카드를 끌어 보드가 커져도 사용자가 민 위치를 뺏지 않는다.
 useEffect(()=>{const el=host.current;if(!ring||!el)return;el.scrollLeft=Math.max(0,(ring.width-el.clientWidth)/2);el.scrollTop=Math.max(0,(ring.height-el.clientHeight)/2)},[ring])
 // 라벨: 중심 보기는 중심 카드에 닿는 선(이 보기의 모든 선)에만, 전체 보기는 마우스를 올리거나 초점을 둔 선 하나에만 그린다(수십 개의 라벨이 서로 겹치지 않게). 선 자체는 툴팁·이름으로 늘 읽힌다.
 const [hot,setHot]=useState(''),[focusCard,setFocusCard]=useState('') // hot: 마우스를 올리거나 초점을 둔 선, focusCard: 키보드 초점이 있는 카드(그 카드에 닿는 선의 라벨도 보인다)
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
 const edges=vm.graph.links.flatMap((l,i)=>{
  const source=mapEndpoint(l.source),target=mapEndpoint(l.target),a=at(source),b=at(target)
  if(!a||!b)return []
  const ax=a.x+cw/2,ay=a.y+ch/2,bx=b.x+cw/2,by=b.y+ch/2,dx=bx-ax,dy=by-ay
  const factor=Math.min((cw/2+10)/Math.max(1,Math.abs(dx)),(ch/2+10)/Math.max(1,Math.abs(dy)))
  const sx=ax+dx*factor,sy=ay+dy*factor,tx=bx-dx*factor,ty=by-dy*factor,c=l.curve??0
  const qx=(ax+bx)/2+dy*c,qy=(ay+by)/2-dx*c,active=!!l.id&&editing.selectedRelations.includes(l.id)
  return [{l,key:l.id??String(i),source,target,sx,sy,tx,ty,qx,qy,d:`M ${sx} ${sy} Q ${qx} ${qy} ${tx} ${ty}`,active,
   color:active?'var(--edge-active,var(--pri))':l.emotion?'var(--edge-emotion,var(--acc-ink))':'var(--edge,var(--pri-ink))',
   name:`${editing.readOnly?'관계선 보기':'관계선 편집'}: ${title(source)} · ${title(target)} · ${l.fullLabel??l.label}`}]
 })
 const labelled=edges.filter(e=>center?e.source===center||e.target===center:hot===e.key||e.source===focusCard||e.target===focusCard)
 const fits=!!ring&&ring.width<=width // 호스트 폭 안에 든 원: 상자가 보드 높이를 그대로 써서 위·아래 카드가 잘리지 않는다(폰처럼 못 들어가면 640px까지, 안에서 스크롤)
 return <div ref={host} className="relationship-cards-scroll" role="group" aria-label={`${subject} 카드 그래프`} style={ring?{height:fits?boardHeight:Math.min(boardHeight,640)}:undefined}>
  <div className="relationship-cards-board" style={{width:boardWidth,height:boardHeight}}>
   <svg width={boardWidth} height={boardHeight} className="relationship-card-edges" role="group" aria-label={`${subject} 사이 관계선`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge,var(--pri-ink))"/></marker></defs>
    {edges.map(e=><g key={e.key}>
     <path d={e.d} fill="none" stroke={e.color} strokeWidth={e.active?3:2} strokeDasharray={e.l.emotion?'6 4':undefined} markerEnd={e.l.symmetric?undefined:`url(#${marker})`}/>
     <path d={e.d} className="relationship-edge-hit" fill="none" stroke="transparent" strokeWidth={16} role="button" tabIndex={-1} aria-label={e.name} onClick={()=>{if(e.l.id&&!editing.busy)editing.onRelation(e.l.id)}} onMouseEnter={()=>setHot(e.key)} onMouseLeave={()=>setHot('')} onFocus={()=>setHot(e.key)} onBlur={()=>setHot('')}><title>{e.l.fullLabel??e.l.label}</title></path>
    </g>)}
   </svg>
   {vm.graph.nodes.map(n=>{const p=at(n.id),portrait=presentationPortrait(n.name),target=!!editing.targetSource&&n.id!==editing.targetSource,selected=vm.selected?.id===n.id
    return <div key={n.id} role="group" data-id={n.id} aria-current={selected||undefined} aria-label={`${n.name} ${n.kind} 카드`} ref={el=>{if(el)cards.current.set(n.id,el);else cards.current.delete(n.id)}} className={'relationship-character-card'+(selected?' selected':'')+(target?' target':'')+(!vm.visible.has(n.id)?' dim':'')} style={{width:cardWidth,height:cardHeight,transform:`translate(${p.x}px, ${p.y}px)`+(k<1?` scale(${k})`:''),transformOrigin:'0 0'}} onPointerDown={e=>start(n.id,e)} onPointerMove={move} onPointerUp={stop} onPointerCancel={()=>{drag.current=null}} onFocus={()=>setFocusCard(n.id)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocusCard('')}}>
     <h4 title={n.name}>{n.type&&<i className="relationship-kind" style={{background:CARD_COLORS[CARD_KIND[n.type]]}} aria-hidden="true"/>}{portrait&&<img src={portrait} alt="" width={36} height={36}/>}{n.name}</h4><p title={n.text}>{n.text||'소개를 입력할 수 있어요.'}</p>
     <div><button type="button" className="btn sm" aria-label={`${n.name} ${editing.readOnly?'상세 보기':'정보 편집'}`} disabled={editing.busy||!!editing.targetSource} onClick={()=>editing.onSelect(n.id)}>{editing.readOnly?'상세 보기':'정보 편집'}</button>
      {!editing.readOnly&&(editing.targetSource?<button type="button" className="btn pri sm" aria-label={`${n.name} 상대 선택`} disabled={editing.busy||n.id===editing.targetSource||n.unnamed} onClick={()=>editing.onSelect(n.id)}>상대 선택</button>:<button type="button" className="btn sm" aria-label={`${n.name} 관계 연결`} disabled={editing.busy||n.unnamed} onClick={()=>editing.onConnect(n.id)}>관계 연결</button>)}
     </div>
    </div>
   })}
   <svg width={boardWidth} height={boardHeight} className="relationship-card-labels" aria-hidden="true">
    {labelled.map(e=>{const mx=(e.sx+2*e.qx+e.tx)/4,my=(e.sy+2*e.qy+e.ty)/4,deg=Math.round(labelAngle(e.tx-e.sx,e.ty-e.sy)*10)/10
     return <text key={e.key} x={mx} y={my-7} textAnchor="middle" fill={e.color} className="relationship-edge-label" transform={`rotate(${deg} ${mx} ${my})`}>{e.l.label}</text>})}
   </svg>
  </div>
 </div>
}
