import {cardTypeOf,type CardType} from './studioCards'
import type {StudioSetting,StudioWorld} from './studioWorld'
export function cardLibraryRows(settings:StudioSetting[],type:CardType|'all',query:string):StudioSetting[]{
 const search=query.trim().toLocaleLowerCase()
 return settings.filter(s=>{
  const kind=cardTypeOf(s.item)
  return kind!=='relation'&&kind!=='review'&&kind!=='note'&&(type==='all'||kind===type)&&[s.item.title,s.item.text,s.userCategory,...s.tags,...(s.aliases??[])].join(' ').toLocaleLowerCase().includes(search)
 })
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
