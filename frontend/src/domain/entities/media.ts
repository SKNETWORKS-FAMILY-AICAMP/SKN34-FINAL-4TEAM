export type MediaTarget =
 | {kind:'setting';workId:string;settingId:string}
 | {kind:'cover';workId:string}
 | {kind:'episode';workId:string;number:number}

export type Attachment = {id:string;filename:string;mediaType:string;kind:'IMAGE'|'FILE';byteSize:number;createdAt:string;url:string}
/** 회차 원고 이미지 목록 항목. 대체 텍스트는 이미지마다 하나이며 버전별로 보존되지 않는다. */
export type EpisodeImage = {id:string;filename:string;mediaType:string;byteSize:number;altText:string;createdAt:string;url:string;referenced:boolean}
export const imageMarker = (id:string) => `[[image:${id}]]`
export const imageReferencePattern = /\[\[image:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi
export const manuscriptText = (body:string) => body.replace(imageReferencePattern,'')
/** 본문에서 한 이미지의 표식을 지운다. 에디터가 넣은 앞뒤 빈 줄도 함께 지워 문단 사이 빈 줄만 남기고, 맨 앞·맨 끝이면 아무것도 남기지 않는다. */
export const removeImageMarker = (body:string,id:string) => body.replace(
 new RegExp(`(\\n*)${imageMarker(id).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\n*)`,'gi'),
 (match,before:string,after:string,offset:number) => offset===0||offset+match.length===body.length?'':before.length>=after.length?before:after,
)
