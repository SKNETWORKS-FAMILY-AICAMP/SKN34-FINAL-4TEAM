import { useState } from 'react'
import type { SettingItem } from '../../../../domain/entities/studioWorld'
import { timelineLayout } from '../viewmodel/worldTimeline'
import './world-timeline.css'

export function WorldTimeline({items}:{items:SettingItem[]}) {
 const nodes=timelineLayout(items),[selected,setSelected]=useState<string|null>(null)
 const current=nodes.find(n=>n.item.id===selected)?.item??nodes[0]?.item
 if(!current)return <p className="world-empty">아직 확정한 과거 사건이 없습니다.</p>
 const width=Math.max(660,...nodes.map(n=>n.column*310+330)),height=Math.max(220,...nodes.map(n=>n.row*150+190))
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 return <div className="world-timeline">
  <p className="small muted">사건을 선택해 내용을 확인하세요. 선은 저장된 선후 관계만 표시합니다.</p>
  <div className="world-timeline-scroll" role="region" aria-label="사건 시간선" tabIndex={0}>
   <div className="world-timeline-board" style={{width,height}}>
    <svg width={width} height={height} aria-hidden="true"><defs><marker id="timeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
     {nodes.map(n=>{const prev=nodes.find(p=>p.item.id===n.item.afterId);return prev?<path key={n.item.id} d={`M ${prev.column*310+40} ${prev.row*150+65} C ${prev.column*310+190} ${prev.row*150+65}, ${n.column*310-100} ${n.row*150+65}, ${n.column*310+40} ${n.row*150+65}`} fill="none" stroke="currentColor" strokeWidth="2" markerEnd="url(#timeline-arrow)"/>:null})}
    </svg>
    {nodes.map(n=><button key={n.item.id} className="world-timeline-event" style={{left:n.column*310+25,top:n.row*150+22}} aria-pressed={current.id===n.item.id} onClick={()=>setSelected(n.item.id)}><span className="world-timeline-time">{n.item.timeText||'시점 미지정'}</span><span className="world-timeline-dot"/><strong>{n.item.title}</strong></button>)}
   </div>
  </div>
  <div className="world-timeline-description" aria-live="polite"><span className="chip">{current.timeText||'시점 미지정'}</span><h4>{current.title}</h4><p className="world-prose">{current.text}</p>{current.afterId&&<p className="small muted">앞선 사건 · {byId(current.afterId)}</p>}<div className="world-timeline-related">{current.relatedIds.map(id=><span className="chip" key={id}>{byId(id)}</span>)}</div></div>
 </div>
}
