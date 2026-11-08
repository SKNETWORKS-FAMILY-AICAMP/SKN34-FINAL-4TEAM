import { useState } from 'react'
import type { SettingItem, StudioWorld } from '../../../../domain/entities/studioWorld'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'

// 설정집 문서 분류: 작성 화면의 카드 유형과 같은 이름을 쓰고, 관계·메모·기존 분석 항목은 뒤에 둡니다.
const wikiGroups=[...cardTypes,{id:'relation',label:'관계'},{id:'note',label:'집필 메모'},{id:'review',label:'기타 설정'}] as const
export const wikiGroupLabel=(item:SettingItem)=>wikiGroups.find(g=>g.id===cardTypeOf(item))?.label??'설정'

export function useWorldWikiViewModel(world:StudioWorld) {
 const [query,setQuery]=useState(''),[trail,setTrail]=useState<string[]>([])
 const documents=world.settings.filter(s=>s.item.decision==='approved')
 const current=documents.find(s=>s.item.id===trail.at(-1))??documents[0]
 const results=documents.filter(s=>[s.item.title,s.item.text,...s.tags].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const groups=wikiGroups.map(group=>({...group,documents:results.filter(s=>cardTypeOf(s.item)===group.id)})).filter(g=>g.documents.length)
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
