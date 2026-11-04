export type MediaTarget =
 | {kind:'setting';workId:string;settingId:string}
 | {kind:'cover';workId:string}
 | {kind:'episode';workId:string;number:number}

export type Attachment = {id:string;filename:string;mediaType:string;kind:'IMAGE'|'FILE';byteSize:number;createdAt:string;url:string}
export const imageMarker = (id:string) => `[[image:${id}]]`
export const imageReferencePattern = /\[\[image:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi
export const manuscriptText = (body:string) => body.replace(imageReferencePattern,'')
