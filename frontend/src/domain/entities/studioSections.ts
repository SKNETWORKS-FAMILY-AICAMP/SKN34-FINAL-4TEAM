import type { SettingItem } from './studioWorld'

// Author entry menus and setting-book headings from the original InitialWorld UI.
export const studioSections=[
 {id:'people',label:'인물'},{id:'places',label:'장소'},
 {id:'basic',label:'기본 설정'},{id:'space',label:'시공간·장소'},
 {id:'history',label:'역사'},{id:'society',label:'사회·조직'},
 {id:'culture',label:'문화·기술'},{id:'special',label:'특수 규칙'},
 {id:'conflict',label:'주요 갈등'},{id:'notes',label:'집필 메모'},
] as const
export type StudioSection=typeof studioSections[number]['id']
export function sectionOf(item:SettingItem):StudioSection {
 if(item.kind==='entity' && item.entityType==='character')return 'people'
 if(item.kind==='entity' && item.entityType==='location')return 'places'
 if(item.kind==='note')return 'notes'
 return item.category
}
export function sectionFields(section:StudioSection):Pick<SettingItem,'kind'|'category'|'entityType'> {
 if(section==='people')return {kind:'entity',category:'basic',entityType:'character'}
 if(section==='places')return {kind:'entity',category:'space',entityType:'location'}
 if(section==='notes')return {kind:'note',category:'basic',entityType:null}
 return {kind:'fact',category:section,entityType:null}
}
