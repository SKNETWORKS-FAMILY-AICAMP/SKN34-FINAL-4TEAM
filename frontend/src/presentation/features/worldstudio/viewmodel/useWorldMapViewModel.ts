import { useMemo, useState } from 'react'
import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { relationLabel } from '../../../../domain/entities/studioRelations'

export const mapColors = { 인물:'#7960c7', 장소:'#328a7d', 조직:'#527daf', 규칙:'#a16c20', 사건:'#b45f86', 관계:'#93617d', 설정:'#64748b' }
export type MapKind = keyof typeof mapColors
export type MapNode = { id:string; name:string; kind:MapKind; text:string; tags:string[]; unnamed?:boolean; x?:number; y?:number; vx?:number; vy?:number; fx?:number; fy?:number }
export type MapLink = { id?:string; symmetric?:boolean; emotion?:boolean; curve?:number; source:string|MapNode; target:string|MapNode; label:string; fullLabel?:string; reverseLabel?:string }
export const mapEndpoint = (node:string|MapNode) => typeof node==='string'?node:node.id

export function buildWorldMap(settings:StudioSetting[]) {
 const saved=settings.filter(s=>s.item.decision==='approved')
 const nodes:MapNode[]=saved.map(({item,tags})=>({id:item.id,name:item.title||'이름 없는 설정',text:item.text,tags:[...tags],kind:
  item.kind==='relation'?'관계':item.kind==='event'?'사건':item.entityType==='character'?'인물':item.entityType==='location'?'장소':item.entityType==='organization'?'조직':item.kind==='rule'||item.kind==='constraint'?'규칙':'설정'}))
 const ids=new Set(nodes.map(n=>n.id)),links:MapLink[]=[]
 let missingLinks=0
 const add=(source:string,target:string,label:string,reverseLabel?:string)=>{
  if(!ids.has(source)||!ids.has(target)){missingLinks++;return}
  if(source!==target)links.push({source,target,label,reverseLabel})
 }
 for(const {item} of saved){
  for(const id of new Set(item.relatedIds))add(item.id,id,'관련 설정')
  if(item.afterId)add(item.afterId,item.id,'이후 사건','이전 사건')
  if(item.kind==='relation'){
   if(item.subjectId)add(item.subjectId,item.id,'관계 주체')
   if(item.targetId)add(item.id,item.targetId,relationLabel(item))
  }
 }
 // ForceGraph mutates nodes and endpoints; never pass canonical objects to it.
 return {nodes,links,missingLinks}
}

export function useWorldMapViewModel(settings:StudioSetting[],project=buildWorldMap) {
 const graph=useMemo(()=>project(settings),[settings,project])
 const [query,setQuery]=useState(''),[kind,setKind]=useState<MapKind|'전체'>('전체'),[selectedId,select]=useState<string|null>(null)
 const selected=graph.nodes.find(n=>n.id===selectedId)??null
 const results=graph.nodes.filter(n=>(kind==='전체'||kind===n.kind)&&[n.name,n.text,...n.tags].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
 const visible=new Set(results.map(n=>n.id))
 const connections=selected?graph.links.filter(l=>mapEndpoint(l.source)===selected.id||mapEndpoint(l.target)===selected.id).map(l=>({label:mapEndpoint(l.target)===selected.id?(l.reverseLabel??l.label):l.label,node:graph.nodes.find(n=>n.id===(mapEndpoint(l.source)===selected.id?mapEndpoint(l.target):mapEndpoint(l.source)))!})):[]
 const neighbors=new Set(selected?[selected.id,...connections.map(c=>c.node.id)]:[])
 return {graph,query,setQuery,kind,setKind,selected,select,results,visible,connections,neighbors}
}
