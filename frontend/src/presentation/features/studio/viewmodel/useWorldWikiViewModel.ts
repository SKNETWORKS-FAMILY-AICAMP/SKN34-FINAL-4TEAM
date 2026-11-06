import { useState } from 'react'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { sectionOf, studioSections } from '../../../../domain/entities/studioSections'

export function useWorldWikiViewModel(world:StudioWorld) {
 const [query,setQuery]=useState(''),[trail,setTrail]=useState<string[]>([])
 const documents=world.settings.filter(s=>s.item.decision==='approved')
 const current=documents.find(s=>s.item.id===trail.at(-1))??documents[0]
 const results=documents.filter(s=>[s.item.title,s.item.text,...s.tags].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const groups=studioSections.map(section=>({...section,documents:results.filter(s=>sectionOf(s.item)===section.id)})).filter(g=>g.documents.length)
 const open=(id:string)=>{
  if(id===current?.item.id||!documents.some(s=>s.item.id===id))return
  const history=trail.length?trail:current?[current.item.id]:[]
  setTrail([...history,id])
 }
 const back=()=>setTrail(trail.slice(0,-1))
 const relations=documents.filter(s=>s.item.kind==='relation'&&(s.item.subjectId===current?.item.id||s.item.targetId===current?.item.id||s.item.id===current?.item.id))
 const related=documents.filter(s=>s.item.id!==current?.item.id&&(current?.item.relatedIds.includes(s.item.id)||s.item.relatedIds.includes(current?.item.id??'')||current?.item.afterId===s.item.id||s.item.afterId===current?.item.id))
 const events=related.filter(s=>s.item.kind==='event')
 const other=related.filter(s=>s.item.kind!=='event'&&s.item.kind!=='relation')
 return {query,setQuery,documents,current,groups,open,back,canGoBack:trail.length>1,relations,events,other}
}
