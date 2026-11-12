import {characterDocIssues} from './characterDocs'
import {cardTypeOf,type CardType} from './studioCards'
import {invalidReveal,REVEAL_EPISODE_ERROR,type StudioSetting,type StudioWorld} from './studioWorld'
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
 for(const setting of world.settings){
  const {item}=setting
  if(!item.title.trim())issues.push({step:'cards',id:item.id,message:'카드 이름을 입력해 주세요.'})
  if(item.kind!=='entity'&&!item.text.trim())issues.push({step:'cards',id:item.id,message:'이 설정의 설명을 입력해 주세요.'})
  if(invalidReveal(setting))issues.push({step:'cards',id:item.id,message:REVEAL_EPISODE_ERROR})
  for(const message of characterDocIssues(setting))issues.push({step:'cards',id:item.id,message})
 }
 return issues
}
/** 사유를 화면에 보일 글. 어느 설정의 문제인지 이름을 앞에 붙여, 저장이 막혔을 때 고칠 설정을 찾아다니지 않게 한다(이름이 빈 설정은 '이름 없는 설정', 세계관 자체의 문제는 사유 그대로). */
export function writingIssueLabel(world:StudioWorld,issue:WritingIssue):string{
 if(!issue.id)return issue.message
 const title=world.settings.find(s=>s.item.id===issue.id)?.item.title.trim()
 return `${title?`‘${title}’`:'이름 없는 설정'}: ${issue.message}`
}
/** `독자 공개 N화부터` 입력을 값으로: 숫자만 남겨 정수로 바꾸고 숫자가 없으면 값이 없다(독자에게 숨김). 0처럼 숫자지만 쓸 수 없는 값은 `invalidReveal`이 가린다. */
export function revealEpisodeInput(text:string):number|undefined{
 const digits=text.replace(/\D/g,'')
 return digits?Number(digits):undefined
}
/** 확정 버전은 서버가 모든 카드의 이름과 설명을 요구한다(초안 저장은 인물 설명을 비워도 된다). 저장된 세계관 기준으로 막을 이유를 알려 준다. 인물 카드의 설명은 IDENTITY.md 문서라 그 이름으로 부른다. */
export function worldSealIssues(world:StudioWorld):WritingIssue[]{
 return [...worldWritingIssues(world),...world.settings.filter(({item})=>item.kind==='entity'&&item.title.trim()&&!item.text.trim())
  .map(({item})=>({step:'cards' as const,id:item.id,message:`‘${item.title.trim()}’의 ${cardTypeOf(item)==='character'?'IDENTITY.md를':'설명을'} 입력해야 확정 버전으로 남길 수 있어요.`}))]
}
