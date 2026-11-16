import type {MediaRepository} from '../repositories/MediaRepository'
import type {MediaTarget} from '../entities/media'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateMediaTarget(target:MediaTarget) {
 if(!uuid.test(target.workId))throw new Error('서버에 저장된 작품을 선택해 주세요.')
 if(target.kind==='setting'&&!uuid.test(target.settingId))throw new Error('설정 초안을 서버에 먼저 저장해 주세요.')
 if(target.kind==='episode'&&(!Number.isSafeInteger(target.number)||target.number<1))throw new Error('서버에 저장된 회차를 선택해 주세요.')
}
export function validateMediaFilename(name:string) {
 if(!/^[\p{L}\p{N} _().-]{1,120}$/u.test(name)||name.startsWith('.')||name.includes('..')||name.trim()!==name)throw new Error('파일 이름은 120자 이내의 문자·숫자·공백·_().-로 지정해 주세요.')
}
export function validateMediaFile(file:File,imagesOnly=false) {
 if(!file.size)throw new Error('빈 파일은 업로드할 수 없어요.')
 if(file.size>10485760)throw new Error('파일은 10 MiB 이하여야 해요.')
 validateMediaFilename(file.name)
 if(!(imagesOnly?/\.(png|jpe?g)$/i:/\.(png|jpe?g|txt|md|csv|pdf)$/i).test(file.name))throw new Error(imagesOnly?'PNG 또는 JPEG 이미지만 사용할 수 있어요.':'PNG·JPEG·TXT·MD·CSV·PDF 파일을 선택해 주세요.')
}
export class MediaUseCase {
 private readonly repository:MediaRepository
 constructor(repository:MediaRepository){this.repository=repository}
 async list(target:MediaTarget,signal?:AbortSignal){validateMediaTarget(target);return this.repository.list(target,signal)}
 async upload(target:MediaTarget,file:File,replaceId?:string,signal?:AbortSignal){validateMediaTarget(target);validateMediaFile(file,target.kind!=='setting');return this.repository.upload(target,file,replaceId,signal)}
 remove(target:MediaTarget,id:string,signal?:AbortSignal){validateMediaTarget(target);if(!uuid.test(id))throw new Error('첨부 식별자를 확인해 주세요.');return this.repository.remove(target,id,signal)}
 /** 설정 첨부의 파일명만 바꾼다. 확장자 유지는 화면이 고정하고 서버가 다시 검사한다. */
 async rename(target:MediaTarget,id:string,filename:string,signal?:AbortSignal){
  validateMediaTarget(target)
  if(target.kind!=='setting')throw new Error('설정 첨부만 이름을 바꿀 수 있어요.')
  if(!uuid.test(id))throw new Error('첨부 식별자를 확인해 주세요.')
  validateMediaFilename(filename)
  return this.repository.rename(target,id,filename,signal)
 }
 async listEpisodeImages(workId:string,number:number,signal?:AbortSignal){
  validateMediaTarget({kind:'episode',workId,number})
  return this.repository.listEpisodeImages(workId,number,signal)
 }
 async updateEpisodeImageAlt(workId:string,number:number,imageId:string,altText:string,signal?:AbortSignal){
  validateMediaTarget({kind:'episode',workId,number})
  if(!uuid.test(imageId))throw new Error('이미지 식별자를 확인해 주세요.')
  const text=altText.trim()
  if(text.length>300)throw new Error('이미지 설명은 300자 이내로 입력해 주세요.')
  if(/\p{Cc}/u.test(text))throw new Error('이미지 설명에는 줄바꿈 같은 제어 문자를 쓸 수 없어요.')
  return this.repository.updateEpisodeImageAlt(workId,number,imageId,text,signal)
 }
 async publicEpisodeImageAlts(workId:string,number:number,signal?:AbortSignal){
  validateMediaTarget({kind:'episode',workId,number})
  return this.repository.publicEpisodeImageAlts(workId,number,signal)
 }
 download(target:MediaTarget,id:string,publicView=false,signal?:AbortSignal){validateMediaTarget(target);if(target.kind!=='cover'&&!uuid.test(id))throw new Error('이미지 식별자를 확인해 주세요.');return this.repository.download(target,id,publicView,signal)}
}
