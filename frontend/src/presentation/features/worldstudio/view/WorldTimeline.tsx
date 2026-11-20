import { useState } from 'react'
import { stripCardLinks } from '../../../../domain/entities/cardLinks'
import type { SettingItem } from '../../../../domain/entities/studioWorld'
import { timelineLayout } from '../viewmodel/worldTimeline'
import './world-timeline.css'

/** 점 중심의 y(사건 버튼 top 22 + 시점 1lh + 점 위 간격 8 + 점 반지름 7 ≈ 58). world-timeline.css의 .world-timeline-event gap과 함께 바꾼다. */
const DOT_Y = 58

export function WorldTimeline({items}:{items:SettingItem[]}) {
 const nodes=timelineLayout(items),[selected,setSelected]=useState<string|null>(null)
 const current=nodes.find(n=>n.item.id===selected)?.item??nodes[0]?.item
 if(!current)return <p className="world-empty">아직 확정한 과거 사건이 없어요.</p>
 const width=Math.max(660,...nodes.map(n=>n.column*310+330)),height=Math.max(220,...nodes.map(n=>n.row*150+190))
 const byId=(id:string|null)=>items.find(i=>i.id===id)?.title??'알 수 없는 항목'
 return <div className="world-timeline">
  <div className="world-timeline-scroll" role="region" aria-label="사건 시간선" tabIndex={0}>
   <div className="world-timeline-board" style={{width,height}}>
    <svg width={width} height={height} aria-hidden="true"><defs><marker id="timeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
     {nodes.map(n=>{const prev=nodes.find(p=>p.item.id===n.item.afterId);return prev?<path key={n.item.id} d={`M ${prev.column*310+40} ${prev.row*150+DOT_Y} C ${prev.column*310+190} ${prev.row*150+DOT_Y}, ${n.column*310-100} ${n.row*150+DOT_Y}, ${n.column*310+40} ${n.row*150+DOT_Y}`} fill="none" stroke="currentColor" strokeWidth="2" markerEnd="url(#timeline-arrow)"/>:null})}
    </svg>
    {nodes.map(n=><button type="button" key={n.item.id} className="world-timeline-event" style={{left:n.column*310+25,top:n.row*150+22}} aria-pressed={current.id===n.item.id} onClick={()=>setSelected(n.item.id)}><span className="world-timeline-time">{n.item.timeText}</span><span className="world-timeline-dot"/><strong>{n.item.title}</strong></button>)}
   </div>
  </div>
  <div className="world-timeline-description" aria-live="polite"><span className="chip">{current.timeText||'시점 미지정'}</span><h4>{current.title}</h4><p className="world-prose">{stripCardLinks(current.text)}</p>{current.afterId&&<p className="small muted">앞선 사건 · {byId(current.afterId)}</p>}<div className="world-timeline-related">{current.relatedIds.map(id=><span className="chip" key={id}>{byId(id)}</span>)}</div></div>
 </div>
}
