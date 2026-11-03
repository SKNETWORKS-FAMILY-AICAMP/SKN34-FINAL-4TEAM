import { sectionFields, type StudioSection } from './studioSections'
export type SettingItem={id:string;kind:'entity'|'fact'|'note';category:'basic'|'space'|'history'|'society'|'culture'|'special'|'conflict';entityType:string|null;topics:string[];title:string;text:string;origin:'author_addition';authorText:string;decision:'approved'}
export type StudioSetting={item:SettingItem;userCategory:string;tags:string[]}
export type StudioWorld={id:string;name:string;description:string;version:number;settings:StudioSetting[]}
export const newSetting=(section:StudioSection='basic'):StudioSetting=>({userCategory:'설정',tags:[],item:{id:crypto.randomUUID(),topics:[],title:'',text:'',origin:'author_addition',authorText:'',decision:'approved',...sectionFields(section)}})
export function authorEdit(s:StudioSetting,patch:Partial<SettingItem>):StudioSetting {const item={...s.item,...patch};return {...s,item:{...item,authorText:item.text}}}
