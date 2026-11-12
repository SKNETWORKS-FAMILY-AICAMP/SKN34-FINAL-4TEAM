import {cardTypeOf,type CardType} from './studioCards'
import type {StudioSetting,StudioWorld} from './studioWorld'
export function cardLibraryRows(settings:StudioSetting[],type:CardType|'all',query:string):StudioSetting[]{
 const search=query.trim().toLocaleLowerCase()
 return settings.filter(s=>{
  const kind=cardTypeOf(s.item)
  return kind!=='relation'&&kind!=='review'&&kind!=='note'&&(type==='all'||kind===type)&&[s.item.title,s.item.text,s.userCategory,...s.tags,...(s.aliases??[])].join(' ').toLocaleLowerCase().includes(search)
 })
}
export function selectCardForFilter(settings:StudioSetting[],selected:string,type:CardType|'all',query:string):string {
 const rows=cardLibraryRows(settings,type,query)
 return rows.some(row=>row.item.id===selected)?selected:rows[0]?.item.id??''
}
export type WritingIssue={step:'info'|'cards';id?:string;message:string}
export function worldWritingIssues(world:StudioWorld):WritingIssue[]{
 const issues:WritingIssue[]=[]
 if(!world.name.trim())issues.push({step:'info',message:'세계관 이름을 입력해 주세요.'})
 for(const {item} of world.settings){
  if(!item.title.trim())issues.push({step:'cards',id:item.id,message:'카드 이름을 입력해 주세요.'})
  if(item.kind!=='entity'&&!item.text.trim())issues.push({step:'cards',id:item.id,message:'이 설정의 설명을 입력해 주세요.'})
 }
 return issues
}
/** 확정 버전은 서버가 모든 카드의 이름과 설명을 요구한다(초안 저장은 인물 설명을 비워도 된다). 저장된 세계관 기준으로 막을 이유를 알려 준다. */
export function worldSealIssues(world:StudioWorld):WritingIssue[]{
 return [...worldWritingIssues(world),...world.settings.filter(({item})=>item.kind==='entity'&&item.title.trim()&&!item.text.trim())
  .map(({item})=>({step:'cards' as const,id:item.id,message:`‘${item.title.trim()}’의 설명을 입력해야 확정 버전으로 남길 수 있어요.`}))]
}
