import type { StudioSetting } from '../../../../domain/entities/studioWorld'
import { relationDefinitions, relationLabel } from '../../../../domain/entities/studioRelations'
import { buildWorldMap, type MapLink } from './useWorldMapViewModel'

export function buildCharacterMap(settings:StudioSetting[]) {
 const nodes=buildWorldMap(settings.filter(s=>s.item.kind==='entity'&&s.item.entityType==='character')).nodes.map(n=>({...n,name:settings.find(s=>s.item.id===n.id)?.item.title||'새 인물',unnamed:!settings.find(s=>s.item.id===n.id)?.item.title.trim()}))
 const ids=new Set(nodes.map(n=>n.id)),links:MapLink[]=[]
 let missingLinks=0
 for(const {item} of settings.filter(s=>s.item.kind==='relation'&&s.item.decision==='approved')) {
  if(!item.subjectId||!item.targetId||item.subjectId===item.targetId||!ids.has(item.subjectId)||!ids.has(item.targetId)){missingLinks++;continue}
  const fullLabel=relationLabel(item),label=Array.from(fullLabel).length>10?Array.from(fullLabel).slice(0,10).join('')+'…':fullLabel
  links.push({id:item.id,source:item.subjectId,target:item.targetId,label,fullLabel,symmetric:!!relationDefinitions[item.predicate??'']?.symmetric,emotion:relationDefinitions[item.predicate??'']?.group==='emotion'})
 }
 for(const link of links) {
  const pair=links.filter(l=>[l.source,l.target].sort().join(':')===[link.source,link.target].sort().join(':'))
  const index=pair.indexOf(link),direction=String(link.source)<String(link.target)?1:-1
  link.curve=direction*(index-(pair.length-1)/2)*.35
 }
 return {nodes,links,missingLinks}
}
